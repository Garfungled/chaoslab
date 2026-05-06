// Shared utilities: RK4 integrator, colormaps

export function rk4(state, f, dt) {
  const k1 = f(state);
  const k2 = f(add(state, scale(k1, dt / 2)));
  const k3 = f(add(state, scale(k2, dt / 2)));
  const k4 = f(add(state, scale(k3, dt)));
  return add(state, scale(add(add(add(k1, scale(k2, 2)), scale(k3, 2)), k4), dt / 6));
}

function add(a, b) { return a.map((v, i) => v + b[i]); }
function scale(a, s) { return a.map(v => v * s); }

// Viridis colormap (50-sample approximation)
const VIRIDIS = [
  [68,1,84],[71,13,96],[72,24,107],[71,35,117],[69,45,124],
  [65,55,129],[61,65,133],[56,75,135],[51,84,137],[47,93,139],
  [42,102,141],[38,111,142],[35,119,142],[32,128,142],[30,137,141],
  [28,145,139],[26,154,137],[26,162,133],[29,170,128],[34,178,122],
  [42,186,114],[53,193,106],[65,200,96],[79,207,85],[95,213,73],
  [114,219,60],[134,224,47],[155,229,33],[177,233,19],[201,237,11],
  [224,240,15],[245,243,41],[253,231,37],[253,218,36],[252,205,37],
  [251,192,37],[250,179,37],[248,166,38],[247,152,41],[245,138,44],
  [243,124,49],[239,110,54],[235,96,61],[231,82,69],[225,68,78],
  [219,55,88],[212,42,99],[202,30,110],[191,20,121],[177,12,132]
];

export function viridis(t) {
  const i = Math.max(0, Math.min(VIRIDIS.length - 1, Math.floor(t * (VIRIDIS.length - 1))));
  return VIRIDIS[i];
}

// Plasma colormap (matplotlib approximation, key-stop interpolation)
const PLASMA_STOPS = [
  [13,8,135],[84,2,163],[139,10,165],[185,50,106],[219,92,57],[253,159,23],[240,249,33]
];

// Inferno colormap
const INFERNO_STOPS = [
  [0,0,4],[52,7,103],[130,28,87],[188,67,48],[228,149,5],[252,255,164]
];

// Magma colormap
const MAGMA_STOPS = [
  [0,0,4],[44,15,74],[114,31,93],[167,66,82],[210,112,69],[249,200,143],[252,253,191]
];

function interpStops(stops, t) {
  const n = stops.length - 1;
  const pos = Math.max(0, Math.min(n, t * n));
  const i = Math.min(Math.floor(pos), n - 1);
  const f = pos - i;
  return stops[i].map((v, k) => Math.round(v * (1 - f) + stops[i + 1][k] * f));
}

export function plasma(t)  { return interpStops(PLASMA_STOPS, t); }
export function inferno(t) { return interpStops(INFERNO_STOPS, t); }
export function magma(t)   { return interpStops(MAGMA_STOPS, t); }

// Hot: black → red → yellow → white
export function hot(t) {
  return [
    Math.min(255, Math.round(t * 3 * 255)),
    Math.min(255, Math.max(0, Math.round((t * 3 - 1) * 255))),
    Math.min(255, Math.max(0, Math.round((t * 3 - 2) * 255))),
  ];
}

// Cool: cyan → magenta
export function cool(t) {
  return [Math.round(t * 255), Math.round((1 - t) * 255), 255];
}

// Grayscale
export function gray(t) {
  const v = Math.round(t * 255); return [v, v, v];
}

export function getColormap(name) {
  switch (name) {
    case 'plasma':  return plasma;
    case 'inferno': return inferno;
    case 'magma':   return magma;
    case 'hot':     return hot;
    case 'cool':    return cool;
    case 'gray':    return gray;
    default:        return viridis;
  }
}

// Map LCE value to [0,1] using linear scale between vmin and vmax
export function normLCE(v, vmin, vmax) {
  return Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin)));
}
