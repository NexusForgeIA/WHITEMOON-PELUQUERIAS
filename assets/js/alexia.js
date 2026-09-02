/* =========================================================================
   Alexia — Agente IA de Peluquería Aurora (demo WhiteMoon)

   Flujo: servicio -> nombre -> teléfono -> día -> hora -> confirmación.
   El día y la hora van DETRÁS del contacto a propósito: así, si alguien
   abandona en el calendario, el lead ya está completo y no se pierde.

   Los huecos NO se inventan en cliente: se piden a la Edge Function
   `peluquerias-cita` (action 'huecos'), y al elegir hora se reserva de
   verdad (action 'reservar'), así la cita aparece en agenda.html.

   El lead se guarda SIEMPRE en leads_web (con cita_dia / cita_hora si las
   hay). El aviso por Telegram, en cambio, es UNO SOLO por evento:
     - con cita reservada  -> avisa `peluquerias-cita` con su "💇 NUEVA CITA"
     - sin cita            -> avisa `peluquerias-notify` con el lead
   Así nunca salen dos mensajes por la misma solicitud.

   Nada de apikeys en cliente: la publishable key solo puede INSERT en
   leads_web vía RLS, y `peluquerias-cita` / `peluquerias-notify` son
   verify_jwt:false con sus tokens en Secrets.

   Estilo de respuesta: máximo 3 frases por mensaje y UNA pregunta cada vez.
   Alexia nunca cierra precios: los importes que cuenta son los orientativos
   públicos de la web, nunca tarifas internas.
   ========================================================================= */
(() => {
  "use strict";

  const SUPABASE_URL = "https://mlaqtniujnvfxcvcourm.supabase.co";
  const SUPABASE_KEY = "sb_publishable_6no6BuOgiA_2nonTJntAuQ_DTqEgrcV";
  const NOTIFY_FN = SUPABASE_URL + "/functions/v1/peluquerias-notify";
  const CITA_FN = SUPABASE_URL + "/functions/v1/peluquerias-cita";
  const LEADS_URL = SUPABASE_URL + "/rest/v1/leads_web";
  const ORIGEN = "demo-peluquerias";
  const SECTOR = "Peluquería";
  const TELEFONO = "643 199 580";

  /* Categorías: los `label` son EXACTAMENTE los data-servicio de los botones
     "Pedir cita" de las tarjetas, para que al entrar desde una tarjeta se
     salte la pregunta inicial.

     `svc` es el nombre del servicio tal y como existe en la agenda (tabla
     servicios_peluqueria), porque es lo que espera `reservar`.

     `dur` es solo el valor por defecto: al abrir el chat se refresca con la
     duración real de la agenda, que el salón puede editar en el panel. */
  const WORKS = [
    { label: "Asesoría de imagen",   interes: "Asesoría de imagen",        svc: "Asesoría de imagen", dur: 30 },
    { label: "Corte y peinado",      interes: "Corte y peinado",           svc: "Corte y peinado",    dur: 45 },
    { label: "Color y tinte",        interes: "Coloración",                svc: "Color y tinte",      dur: 90 },
    { label: "Mechas y balayage",    interes: "Mechas / balayage",         svc: "Mechas y balayage",  dur: 150 },
    { label: "Tratamientos capilares", interes: "Tratamiento capilar",     svc: "Tratamiento capilar", dur: 45 },
    { label: "Keratina y alisado",   interes: "Keratina / alisado",        svc: "Keratina y alisado", dur: 120 },
    { label: "Recogidos y novia",    interes: "Recogido de evento",        svc: "Recogido de evento", dur: 60 },
    { label: "Extensiones",          interes: "Extensiones",               svc: "Extensiones",        dur: 120 },
    { label: "Brushing y peinado",   interes: "Brushing / peinado exprés", svc: "Brushing y peinado", dur: 30 },
    { label: "Barbería",             interes: "Barbería / corte caballero", svc: "Barbería",          dur: 30 },
  ];

  /* Qué incluye cada servicio — se cuenta antes de pedir los datos.
     Máximo 3 frases, sin preguntas: la pregunta va siempre aparte.
     Los importes son los mismos precios orientativos que aparecen en la web. */
  const INFO = {
    "Asesoría de imagen": "La asesoría es gratis y sin compromiso: miramos tu pelo, hablamos de lo que buscas y te decimos qué se puede hacer de verdad. Si hay que ir por pasos, te lo contamos antes de empezar.",
    "Corte y peinado": "Corte trabajado sobre tu tipo de pelo, con lavado y peinado incluidos. Salen unos 45 minutos. Orientativo desde 25 €.",
    "Color y tinte": "Color de raíz a puntas o solo retoque, con test de mechón previo si cambias mucho de tono. Suele llevar hora y media. Orientativo desde 45 €.",
    "Mechas y balayage": "Balayage, babylights o mechas clásicas, siempre con matizado y tratamiento de protección. Es la técnica más larga del salón: cuenta con dos horas y media. Orientativo desde 75 €.",
    "Tratamientos capilares": "Hidratación profunda o reparación según cómo esté tu fibra capilar. Incluye ritual de lavado y masaje en el lavacabezas. Orientativo desde 30 €.",
    "Keratina y alisado": "Alisado de keratina para reducir encrespamiento y bajar el tiempo de secado en casa. Dura unos meses según tu pelo y tus lavados. Orientativo desde 90 €.",
    "Recogidos y novia": "Recogidos, semirrecogidos y peinados de evento. Para novia hacemos prueba previa aparte, para llegar al día tranquila. Orientativo desde 45 €.",
    "Extensiones": "Colocación y adaptación del color al tuyo, con corte final para que el pelo caiga natural. También hacemos el mantenimiento después. Orientativo desde 150 €.",
    "Brushing y peinado": "El peinado exprés de media hora: lavado, secado y brushing con volumen o liso. Es lo que se pide antes de una cena o una reunión. Orientativo desde 18 €.",
    "Barbería": "Corte de caballero, arreglo de barba y perfilado. Media hora y sales listo. Orientativo desde 16 €.",
  };

  /* ---------- fechas ---------- */
  const MESES_VISTA = 6;
  const DIAS_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];
  const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

  const hoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const mismoDia = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  /* getDay() da domingo=0, que descoloca la rejilla: aquí lunes=0 */
  const diaSemanaLunes = (d) => (d.getDay() + 6) % 7;
  const formatoLargo = (d) =>
    d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const formatoCorto = (d) =>
    d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const isoLocal = (d) =>
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  /* Los ISO que devuelve `huecos` ya vienen en hora de Madrid con su offset
     ("2026-09-03T10:30:00+02:00"). Se cortan a pelo en vez de pasar por Date
     para que el navegador no los reinterprete en su propia zona horaria. */
  const horaDe = (iso) => iso.slice(11, 16);

  /* Un día es candidato si es laborable y no ha pasado. Es la misma regla que
     aplica peluquerias-cita en `esLaborable`; sirve para no lanzar 30
     peticiones por mes solo para pintar el calendario. Los huecos reales se
     piden al elegir día. */
  const diaCandidato = (fecha) => diaSemanaLunes(fecha) <= 4 && fecha >= hoy();

  const $ = (s, c = document) => c.querySelector(s);
  const panel = $("#alexia");
  if (!panel) return;
  const body = $(".alexia-body", panel);
  const quick = $(".alexia-quick", panel);
  const form = $(".alexia-foot", panel);
  const input = $(".alexia-foot input", panel);
  const sendBtn = $(".alexia-foot button", panel);
  const btn = $("#alexia-open");

  const lead = {
    servicio: "", interes: "", svc: "", dur: 45,
    nombre: "", telefono: "",
    dia: "", diaISO: "", hora: "", citaAt: "", citaId: "",
  };
  let step = "work";       // work -> name -> phone -> fecha -> hora -> done
  let started = false;
  let vista = null;        // mes que pinta el calendario
  let enviado = false;     // el lead solo se manda una vez

  /* ---------- helpers UI ---------- */
  const scroll = () => { body.scrollTop = body.scrollHeight; };
  const addMsg = (text, who = "bot") => {
    const el = document.createElement("div");
    el.className = "alexia-msg " + who;
    el.textContent = text;
    body.appendChild(el); scroll();
  };
  const typing = () => {
    const t = document.createElement("div");
    t.className = "alexia-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    body.appendChild(t); scroll();
    return t;
  };
  const botSay = (text, after) =>
    new Promise((res) => {
      const t = typing();
      setTimeout(() => {
        t.remove(); addMsg(text, "bot");
        if (after) after();
        res();
      }, Math.min(900, 340 + text.length * 8));
    });
  const clearQuick = () => { quick.innerHTML = ""; };
  const setQuick = (items, onPick) => {
    clearQuick();
    items.forEach((it) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label || it;
      b.addEventListener("click", () => onPick(it));
      quick.appendChild(b);
    });
  };
  const setInput = (enabled, placeholder) => {
    input.disabled = !enabled; sendBtn.disabled = !enabled;
    input.placeholder = placeholder || "Escribe tu respuesta…";
    if (enabled) setTimeout(() => input.focus(), 60);
  };

  /* Widget único: se vuelve a pintar en el sitio en vez de apilar copias */
  const widget = (cls) => {
    let w = $("#alexia-widget", body);
    if (!w) { w = document.createElement("div"); w.id = "alexia-widget"; body.appendChild(w); }
    w.className = cls;
    w.innerHTML = "";
    scroll();
    return w;
  };
  const quitaWidget = () => { const w = $("#alexia-widget", body); if (w) w.remove(); };

  /* ---------- llamadas a peluquerias-cita ---------- */
  const agenda = async (payload) => {
    try {
      const r = await fetch(CITA_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) console.warn("[alexia] peluquerias-cita", r.status, data);
      return data;
    } catch (e) {
      console.warn("[alexia] peluquerias-cita sin red:", e);
      return { _neterr: true };
    }
  };

  /* Duraciones reales de la agenda: el salón puede cambiarlas desde el panel,
     y la duración decide qué huecos entran. Si falla, se siguen usando las
     de WORKS. */
  const sincronizaDuraciones = async () => {
    const res = await agenda({ action: "servicios-list" });
    if (!res || !res.ok || !Array.isArray(res.servicios)) return;
    const porNombre = new Map(res.servicios.map((s) => [s.nombre, s]));
    WORKS.forEach((w) => {
      const s = porNombre.get(w.svc);
      if (s && s.duracion_min) w.dur = s.duracion_min;
    });
  };

  /* ---------- flujo ---------- */
  const start = async () => {
    if (started) return; started = true;
    setInput(false);
    sincronizaDuraciones();
    await botSay("Hola, soy Alexia, el asistente de Peluquería Aurora. Te busco cita en un minuto, sin llamadas.");
    await botSay("¿Qué te apetece hacerte?", () => {
      setQuick(WORKS, (w) => { addMsg(w.label, "user"); pickWork(w.label); });
    });
  };

  /* Elegido el servicio: primero cuenta qué incluye, luego pide el nombre. */
  const pickWork = async (label) => {
    const w = WORKS.find((x) => x.label === label) || WORKS[0];
    lead.servicio = w.label;
    lead.interes = w.interes;
    lead.svc = w.svc;
    lead.dur = w.dur;
    clearQuick();
    const info = INFO[w.label];
    if (info) await botSay(info);
    askName();
  };

  const askName = async () => {
    step = "name";
    clearQuick();
    await botSay("Voy a buscarte hueco. ¿A nombre de quién pongo la cita?",
      () => setInput(true, "Tu nombre…"));
  };

  const askPhone = async () => {
    step = "phone";
    await botSay("Gracias, " + lead.nombre.split(" ")[0] + ". ¿A qué teléfono te avisamos si hay algún cambio?", () =>
      setInput(true, "Tu teléfono…")
    );
  };

  /* ---------- día ---------- */
  const askFecha = async () => {
    step = "fecha";
    clearQuick();
    if (!vista) { const t = hoy(); vista = new Date(t.getFullYear(), t.getMonth(), 1); }
    await botSay("Ya te tengo apuntado. ¿Qué día te viene bien? Abrimos de lunes a viernes.", () => {
      setInput(false, "Elige un día en el calendario");
      pintaCalendario();
    });
  };

  function pintaCalendario() {
    const box = widget("alexia-cal");
    const t = hoy();
    const mesActual = new Date(t.getFullYear(), t.getMonth(), 1);
    const limite = new Date(t.getFullYear(), t.getMonth() + MESES_VISTA, 1);

    const nav = document.createElement("div");
    nav.className = "alexia-cal__nav";
    const mk = (txt, aria, off, dis) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "alexia-cal__btn"; b.textContent = txt;
      b.setAttribute("aria-label", aria); b.disabled = dis;
      b.addEventListener("click", () => {
        vista = new Date(vista.getFullYear(), vista.getMonth() + off, 1);
        pintaCalendario();
      });
      return b;
    };
    /* Sin retroceder del mes actual */
    nav.appendChild(mk("‹", "Mes anterior", -1, vista <= mesActual));
    const etiquetaMes = vista.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    const titulo = document.createElement("p");
    titulo.className = "alexia-cal__mes";
    titulo.setAttribute("aria-live", "polite");
    /* es-ES da "septiembre de 2026"; con capitalize saldría "Septiembre De 2026" */
    titulo.textContent = etiquetaMes.charAt(0).toUpperCase() + etiquetaMes.slice(1);
    nav.appendChild(titulo);
    nav.appendChild(mk("›", "Mes siguiente", 1, vista >= limite));
    box.appendChild(nav);

    const grid = document.createElement("div");
    grid.className = "alexia-cal__grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Días disponibles de " + etiquetaMes);
    DIAS_CORTOS.forEach((d, i) => {
      const c = document.createElement("span");
      c.className = "alexia-cal__wd"; c.setAttribute("aria-hidden", "true");
      c.textContent = d; c.title = DIAS_LARGOS[i];
      grid.appendChild(c);
    });
    const primero = new Date(vista.getFullYear(), vista.getMonth(), 1);
    for (let h = 0; h < diaSemanaLunes(primero); h++) {
      const v = document.createElement("span");
      v.className = "alexia-cal__day is-empty"; v.setAttribute("aria-hidden", "true");
      grid.appendChild(v);
    }
    const ultimo = new Date(vista.getFullYear(), vista.getMonth() + 1, 0).getDate();
    for (let n = 1; n <= ultimo; n++) {
      const fecha = new Date(vista.getFullYear(), vista.getMonth(), n);
      const b = document.createElement("button");
      b.type = "button"; b.className = "alexia-cal__day"; b.textContent = String(n);
      if (mismoDia(fecha, new Date())) b.classList.add("is-today");
      if (!diaCandidato(fecha)) {
        b.disabled = true;
        b.setAttribute("aria-label", formatoLargo(fecha) + ", cerrado");
      } else {
        b.setAttribute("aria-label", formatoLargo(fecha));
        b.addEventListener("click", () => eligeFecha(fecha));
      }
      grid.appendChild(b);
    }
    box.appendChild(grid);

    const nota = document.createElement("p");
    nota.className = "alexia-cal__nota";
    nota.textContent = "Lunes a viernes. Si lo necesitas para hoy mismo, llámanos al " + TELEFONO + ".";
    box.appendChild(nota);

    /* Salida sin cita: se cierra igual y llamamos nosotros. */
    const salir = document.createElement("button");
    salir.type = "button"; salir.className = "alexia-back";
    salir.textContent = "Prefiero que me llaméis vosotros";
    salir.addEventListener("click", () => {
      addMsg("Prefiero que me llaméis vosotros", "user");
      quitaWidget();
      cierreSinCita();
    });
    box.appendChild(salir);
  }

  const eligeFecha = async (fecha) => {
    lead.dia = formatoLargo(fecha);
    lead.diaISO = isoLocal(fecha);
    addMsg(formatoCorto(fecha), "user");
    quitaWidget();
    askHora(fecha);
  };

  /* ---------- hora: huecos REALES de la agenda ---------- */
  const askHora = async (fecha) => {
    step = "hora";
    const t = typing();
    const res = await agenda({ action: "huecos", dia: lead.diaISO, duracion_min: lead.dur });
    t.remove();

    const huecos = res && res.ok && Array.isArray(res.huecos) ? res.huecos : [];
    if (!huecos.length) {
      const motivo = res && res._neterr
        ? "No he podido consultar la agenda ahora mismo."
        : "Ese día lo tenemos completo.";
      await botSay(motivo + " ¿Probamos con otro?", () => pintaSinHuecos());
      return;
    }
    await botSay("Perfecto. ¿A qué hora te viene mejor?", () => {
      setInput(false, "Elige una hora");
      pintaHoras(huecos, fecha);
    });
  };

  function pintaSinHuecos() {
    const box = widget("alexia-slots");
    const atras = document.createElement("button");
    atras.type = "button"; atras.className = "alexia-back";
    atras.textContent = "Elegir otro día";
    atras.addEventListener("click", () => { quitaWidget(); askFecha(); });
    box.appendChild(atras);
    const salir = document.createElement("button");
    salir.type = "button"; salir.className = "alexia-back";
    salir.textContent = "Prefiero que me llaméis vosotros";
    salir.addEventListener("click", () => {
      addMsg("Prefiero que me llaméis vosotros", "user");
      quitaWidget();
      cierreSinCita();
    });
    box.appendChild(salir);
  }

  function pintaHoras(huecos, fecha) {
    const box = widget("alexia-slots");
    /* El salón abre en dos bloques (mañana y tarde); se agrupan por la hora
       del propio hueco en vez de repetir aquí los tramos del backend. */
    const manana = huecos.filter((h) => parseInt(horaDe(h), 10) < 14);
    const tarde = huecos.filter((h) => parseInt(horaDe(h), 10) >= 14);
    [["Mañana", manana], ["Tarde", tarde]].forEach(([etiqueta, lista]) => {
      if (!lista.length) return;
      const sep = document.createElement("p");
      sep.className = "alexia-slots__sep";
      sep.textContent = etiqueta;
      box.appendChild(sep);
      lista.forEach((iso) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "alexia-slot"; b.textContent = horaDe(iso);
        b.setAttribute("aria-label", horaDe(iso) + " del " + formatoCorto(fecha));
        b.addEventListener("click", () => eligeHora(iso, fecha));
        box.appendChild(b);
      });
    });
    const atras = document.createElement("button");
    atras.type = "button"; atras.className = "alexia-back";
    atras.textContent = "Elegir otro día";
    atras.addEventListener("click", () => { addMsg("Prefiero otro día", "user"); quitaWidget(); askFecha(); });
    box.appendChild(atras);
  }

  const eligeHora = async (iso, fecha) => {
    lead.hora = horaDe(iso);
    lead.citaAt = iso;
    addMsg(lead.hora, "user");
    quitaWidget();
    reservar(fecha);
  };

  /* Tarjeta de éxito: el SVG del check es decorativo (aria-hidden), el texto
     es quien transmite el resultado. */
  const tarjetaExito = (texto) => {
    const el = document.createElement("div");
    el.className = "alexia-ok";
    el.setAttribute("role", "status");
    const ic = document.createElement("span");
    ic.className = "alexia-ok__ic";
    ic.setAttribute("aria-hidden", "true");
    ic.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    const p = document.createElement("p");
    p.textContent = texto;
    el.append(ic, p);
    body.appendChild(el);
    scroll();
  };

  /* ---------- reserva real contra la agenda ---------- */
  const reservar = async (fecha) => {
    setInput(false); clearQuick();
    const t = typing();
    const res = await agenda({
      action: "reservar",
      cliente_nombre: lead.nombre,
      cliente_telefono: lead.telefono,
      servicio: lead.svc,
      duracion_min: lead.dur,
      cita_at: lead.citaAt,
    });
    t.remove();

    /* Se lo ha llevado otra persona entre que pintamos los huecos y confirmó */
    if (res && res.ok === false && res.reason) {
      await botSay("Vaya, ese hueco lo acaban de coger. Te enseño los que siguen libres ese día.");
      askHora(fecha);
      return;
    }

    if (!res || !res.ok) {
      /* La agenda no responde, pero el lead no se pierde: lo guardamos con la
         franja que pidió y que le llamen para confirmarla. */
      await cierreSinCita(true);
      return;
    }

    step = "done";
    lead.citaId = res.cita_id || "";
    await enviarLead();
    tarjetaExito("¡Listo! Cita confirmada para el " + lead.dia + " a las " + lead.hora + ".");
    setTimeout(
      () => addMsg(
        "Te esperamos para tu " + lead.servicio.toLowerCase() +
        ". Si necesitas cambiarla, llámanos al " + TELEFONO + ".", "bot"
      ),
      700
    );
  };

  /* Cierre sin hueco confirmado: el lead se guarda igual. */
  const cierreSinCita = async (conFranja) => {
    step = "done";
    setInput(false); clearQuick(); quitaWidget();
    const t = typing();
    if (!conFranja) { lead.dia = ""; lead.diaISO = ""; lead.hora = ""; }
    const ok = await enviarLead();
    t.remove();
    if (ok) {
      tarjetaExito("Anotado. Te llamamos al " + lead.telefono + " para cerrar el día y la hora.");
    } else {
      addMsg(
        "He guardado tus datos pero hubo un problema de conexión. Para no esperar, llámanos al " + TELEFONO + " y te atendemos al momento.",
        "bot"
      );
    }
  };

  /* ---------- entrada de texto ---------- */
  /* Guard: mínimo 9 dígitos reales (admite prefijo +34 / 0034 y separadores). */
  const isPhone = (v) => {
    const d = String(v).replace(/\D/g, "").replace(/^(?:0034|34)(?=[6-9]\d{8})/, "");
    return d.length >= 9 && /^[6-9]\d{8,}$/.test(d);
  };
  const handleText = (raw) => {
    const v = raw.trim();
    if (!v) return;
    addMsg(v, "user");
    input.value = "";
    if (step === "name") {
      if (v.length < 2) { botSay("¿Me dices tu nombre, por favor?"); return; }
      lead.nombre = v; setInput(false); askPhone();
    } else if (step === "phone") {
      if (!isPhone(v)) { botSay("Ese teléfono no parece válido. Escríbelo con 9 dígitos, por favor."); return; }
      lead.telefono = v; setInput(false); askFecha();
    }
  };

  form.addEventListener("submit", (e) => { e.preventDefault(); handleText(input.value); });

  /* Con nombre y teléfono ya tenemos un lead válido. Si se marcha en mitad
     del calendario, se manda igual al salir de la página: mejor un lead sin
     franja que ningún lead. */
  window.addEventListener("pagehide", () => {
    if (!enviado && lead.nombre && lead.telefono) enviarLead();
  });

  /* ---------- envío del lead ----------
     fetch con keepalive (sobrevive a que se cierre la pestaña). El INSERT en
     leads_web NO puede ir por sendBeacon: PostgREST exige Content-Type
     application/json y las cabeceras apikey/Authorization, y sendBeacon no
     deja poner cabeceras. Para el aviso, que sí acepta la apikey en query
     string, se deja el beacon como último recurso. */
  const beacon = (url, payload) => {
    if (!navigator.sendBeacon) return false;
    try {
      const sep = url.includes("?") ? "&" : "?";
      return navigator.sendBeacon(
        url + sep + "apikey=" + encodeURIComponent(SUPABASE_KEY),
        new Blob([JSON.stringify(payload)], { type: "application/json" })
      );
    } catch (e) { return false; }
  };

  const post = async (url, payload, opts) => {
    const conBeacon = !(opts && opts.noBeacon);
    try {
      const r = await fetch(url, {
        method: "POST",
        keepalive: true,
        headers: Object.assign({
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + SUPABASE_KEY,
          "Content-Type": "application/json",
        }, (opts && opts.headers) || {}),
        body: JSON.stringify(payload),
      });
      if (r.ok) return true;
      console.warn("[alexia]", url, r.status, await r.text());
      return conBeacon ? beacon(url, payload) : false;
    } catch (e) {
      console.warn("[alexia] error de red:", e);
      return conBeacon ? beacon(url, payload) : false;
    }
  };

  async function enviarLead() {
    if (enviado) return true;
    enviado = true;

    const cita = lead.diaISO && lead.hora ? " · Cita: " + lead.dia + " a las " + lead.hora : "";

    // 1) INSERT en leads_web (publishable key, solo INSERT vía RLS)
    const inserted = await post(LEADS_URL, {
      nombre: lead.nombre,
      telefono: lead.telefono,
      sector: SECTOR,
      interes: lead.interes,
      mensaje: "Servicio: " + lead.servicio + cita,
      origen: ORIGEN,
      cita_dia: lead.diaISO || null,
      cita_hora: lead.hora || null,
    }, { headers: { "Prefer": "return=minimal" }, noBeacon: true });

    // 2) Aviso por Telegram SOLO si no ha habido reserva.
    //    Cuando `reservar` sale bien, peluquerias-cita ya manda su
    //    "💇 NUEVA CITA": disparar aquí el aviso de lead dejaría dos Telegram
    //    por la misma reserva. Con cita_id el aviso ya está dado; sin él,
    //    este es el único.
    if (!lead.citaId) {
      await post(NOTIFY_FN, {
        nombre: lead.nombre,
        telefono: lead.telefono,
        motivo: lead.servicio,
        dia: lead.dia,
        hora: lead.hora,
        reservada: false,
        origen: ORIGEN,
      });
    }

    return inserted;
  }

  /* ---------- abrir / cerrar ---------- */
  const open = (servicio) => {
    panel.classList.add("open");
    /* Cerrado el panel es invisible pero sus botones seguirían siendo
       enfocables con el teclado: inert los saca del recorrido de tabulación. */
    panel.removeAttribute("inert");
    if (btn) btn.style.display = "none";
    start();
    /* Si vienen de una tarjeta de servicio, saltamos la elección de categoría. */
    if (servicio && step === "work") {
      setTimeout(() => {
        if (step !== "work") return;
        addMsg(servicio, "user");
        pickWork(servicio);
      }, 900);
    }
  };
  const close = () => {
    panel.classList.remove("open");
    panel.setAttribute("inert", "");
    if (btn) btn.style.display = "";
    if (btn) btn.focus();
  };
  btn && btn.addEventListener("click", () => open());
  $(".alexia-head__close", panel).addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) close();
  });
  document.querySelectorAll("[data-alexia]").forEach((el) =>
    el.addEventListener("click", (e) => { e.preventDefault(); open(el.dataset.servicio); })
  );
})();
