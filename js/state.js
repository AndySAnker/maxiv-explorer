// Shared mutable game state
export const G = {
  scene: null, camera: null, renderer: null, sun: null,
  time: 0,
  hide: {},            // name -> THREE.Group, toggled by zones
  zones: [],           // {name, test(x,z,y), hide?:[groupName|Object3D], flags}
  doors: [],
  interact: [],        // {x,z,y,r,label|fn, cond?, act, hold?}
  beamlines: [],
  photons: [],
  npcs: [], vehicles: [], officers: [],
  nav: { nodes: [] },
  tickers: [],         // per-frame callbacks (dt)
  spinners: [],        // objects rotated each frame {obj, axis, speed}
  blinkers: [],        // {mesh, period}
  player: null,
  money: 0, wanted: 0, wantedCool: 0, health: 100, dose: 0, badge: false,
  ring: { cur3: 399.6, cur1: 500, beamOn: true, access: false, topup: 45, dumpT: -999, injecting: 0 },
  flags: {},
  access: {},          // beamline name -> true while a mission lets you into a closed hutch
  currentZone: null, zoneFlags: {},
  stats: { photons: 0, missions: 0 },
};
