// Settings management — stored in localStorage, synced across tabs

export const DEFAULTS = {
  // Pendulum background + foreground
  pend_bg:         '#ffffff',
  pend_rod:        '#000000',
  pend_bob:        '#0000c8',
  // Pendulum trail
  pend_trail:      '#e6e6e6',
  pend_trail_w:    1,
  // LCE mode
  pend_pert:       '#dc3c00',   // perturbed pendulum color
  pend_vis_eps:    0.05,        // visible offset (radians)
  pend_lce_eps:    1e-6,        // actual LCE epsilon
  // Heatmap
  hm_pend_cmap:    'viridis',
  hm_nbody_cmap:   'viridis',
  // N-body
  nb_bg:           '#0f1923',
  // Stats overlay
  show_stats:      true,
};

const KEY = 'chaoslab_settings';

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch(e) {}
  return { ...DEFAULTS };
}

export function save(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent('chaosSettingsChanged', { detail: settings }));
}

export function get(key) {
  return load()[key] ?? DEFAULTS[key];
}

export function reset() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent('chaosSettingsChanged', { detail: { ...DEFAULTS } }));
}

// Cross-tab sync: when another tab calls save(), re-dispatch here
window.addEventListener('storage', e => {
  if (e.key !== KEY) return;
  const settings = e.newValue
    ? { ...DEFAULTS, ...JSON.parse(e.newValue) }
    : { ...DEFAULTS };
  window.dispatchEvent(new CustomEvent('chaosSettingsChanged', { detail: settings }));
});
