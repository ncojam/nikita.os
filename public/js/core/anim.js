/* ================= анимации ================= */
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const EASE = "cubic-bezier(.2, .8, .2, 1)";

const D = ms => (REDUCED ? 0 : ms);

export { REDUCED, EASE, D };
