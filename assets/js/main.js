/* =========================================================================
   Peluquería Aurora — interacciones
   Sin librerías externas. Respeta prefers-reduced-motion.
   ========================================================================= */
(() => {
  "use strict";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  /* ---------- Scroll: un solo listener, agrupado en rAF ----------
     Leer scrollY/offsetTop y escribir clases en el mismo tick provoca
     forced reflow. Aquí se lee una vez por frame y las medidas de sección
     van en caché. */
  const nav = $("#nav");
  const onScrollFns = [];
  let ticking = false;
  const runScroll = () => {
    const y = window.scrollY;
    onScrollFns.forEach((fn) => fn(y));
    ticking = false;
  };
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(runScroll);
    },
    { passive: true }
  );

  if (nav) onScrollFns.push((y) => nav.classList.toggle("scrolled", y > 20));

  /* ---------- Menú móvil ---------- */
  const burger = $("#burger");
  const menu = $("#mobileMenu");
  if (burger && menu) {
    const setMenu = (open) => {
      menu.classList.toggle("open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
      document.body.style.overflow = open ? "hidden" : "";
    };
    burger.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
    $$("a, .btn", menu).forEach((el) => el.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu.classList.contains("open")) setMenu(false);
    });
  }

  /* ---------- Scroll-spy del nav ----------
     Manda "la última sección rebasada": es lo que da el resultado correcto
     también al final de la página, donde lo visible es el pie y no hay
     ninguna sección en pantalla. La medida se toma en rAF (ya después del
     primer pintado) y queda en caché: durante el scroll no se lee layout. */
  const spy = $$("#navLinks a");
  const sections = $$("main section[id]");
  if (spy.length && sections.length) {
    let marks = [];
    let last = null;
    const measure = () => {
      marks = sections.map((s) => ({ id: s.id, top: s.offsetTop - 160 }));
    };
    const sync = (y) => {
      if (!marks.length) return;
      let current = marks[0].id;
      for (let i = 0; i < marks.length; i++) if (y >= marks[i].top) current = marks[i].id;
      if (current === last) return;
      last = current;
      spy.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + current));
    };
    const remeasure = () => { measure(); last = null; sync(window.scrollY); };
    requestAnimationFrame(remeasure);
    onScrollFns.push(sync);
    window.addEventListener("load", () => requestAnimationFrame(remeasure));
    let rt;
    const remeasureDebounced = () => { clearTimeout(rt); rt = setTimeout(remeasure, 150); };
    window.addEventListener("resize", remeasureDebounced, { passive: true });
    /* Con content-visibility las secciones aún sin pintar ocupan la altura
       estimada; al materializarse cambian de alto y los offsetTop cacheados
       se quedan viejos. El ResizeObserver vuelve a medir cuando eso pasa. */
    if ("ResizeObserver" in window) {
      new ResizeObserver(remeasureDebounced).observe(document.body);
    }
  }

  /* ---------- Marquee: duplicar para bucle continuo ---------- */
  const marquee = $("#marquee");
  if (marquee && !reduced) marquee.innerHTML += marquee.innerHTML;

  /* ---------- Palabra rotativa del hero ---------- */
  const rot = $("#rotWord");
  if (rot && !reduced) {
    const words = ["color", "mechas y balayage", "corte y peinado", "keratina", "recogidos de evento"];
    let i = 0;
    setInterval(() => {
      rot.classList.add("out");
      setTimeout(() => {
        i = (i + 1) % words.length;
        rot.textContent = words[i];
        rot.classList.remove("out");
      }, 420);
    }, 2600);
  }

  /* ---------- Reveal al hacer scroll ---------- */
  const reveals = $$(".reveal");
  if (reveals.length && "IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e, n) => {
          if (!e.isIntersecting) return;
          e.target.style.transitionDelay = Math.min(n * 70, 280) + "ms";
          e.target.classList.add("in");
          io.unobserve(e.target);
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" }
    );
    reveals.forEach((el) => io.observe(el));

    /* Si se entra por un enlace profundo (#precios, #faq…), se restaura la
       posición de scroll o se salta de golpe, todo lo que queda por encima
       nunca llega a intersecar y se quedaría invisible para siempre.
       Revelamos de golpe lo que ya está en pantalla o por encima. */
    const revealPasados = () => {
      const limite = window.innerHeight * 0.94;
      /* Primero se lee todo, después se escribe: intercalar lecturas de
         getBoundingClientRect con cambios de clase fuerza un reflow por
         elemento. */
      const pendientes = reveals.filter((el) => !el.classList.contains("in"));
      const tops = pendientes.map((el) => el.getBoundingClientRect().top);
      pendientes.forEach((el, i) => {
        if (tops[i] < limite) {
          el.style.transitionDelay = "0ms";
          el.classList.add("in");
          io.unobserve(el);
        }
      });
    };
    requestAnimationFrame(revealPasados);
    window.addEventListener("load", () => requestAnimationFrame(revealPasados));
    window.addEventListener("hashchange", () => setTimeout(revealPasados, 420));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------- Año del footer ---------- */
  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- Guardia anti-overflow horizontal ----------
     Solo en local: leer scrollWidth/clientWidth fuerza un layout síncrono y
     esto es una ayuda de desarrollo, no algo que deba pagar el visitante. */
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    window.addEventListener("load", () => {
      const check = () => {
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth) {
          console.warn("[layout] overflow horizontal:", de.scrollWidth, ">", de.clientWidth);
        }
      };
      if (window.requestIdleCallback) requestIdleCallback(check);
      else setTimeout(check, 300);
    });
  }
})();
