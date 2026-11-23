// Static world data: geometry constants, beamlines, photos, phrases.
// Coordinates: 1 unit = 1 metre. +x = east, +z = south (north is -z). Angles: a -> (cos a, sin a).

export const R3 = { // 3 GeV storage ring (528 m circumference)
  cx: 0, cz: 0, rBeam: 84,
  inner: 61.75,          // courtyard-side facade
  outer: 117,            // outer facade
  tunIn: 79, tunInT: 1.0, // inner shielding wall (radius, thickness)
  tunOut: 88.5, tunOutT: 1.5,
  tunH: 4.3, hallH: 13,
  rackR: 76.4,
  outerDoors: [{ a: 0, w: 5 }, { a: 90, w: 5 }, { a: 180, w: 8 }, { a: 270, w: 5 }],
  innerDoors: [{ a: 90, w: 4 }, { a: 270, w: 4 }],
  bridges: [90, 270],
  tunnelDoor: 180,
  dims: { o0: 35, o1: 41, e0: 43, e1: 53, c0: 43, c1: 48, ow: 1.6, ew: 2.2, cl0: 3.4, cl1: 6.4 },
};

export const R1 = { // 1.5 GeV storage ring (96 m circumference)
  cx: -160, cz: -100, rBeam: 15.3,
  outer: 40, tunIn: 12.6, tunInT: 1.0, tunOut: 18.5, tunOutT: 1.4,
  tunH: 3.6, hallH: 9,
  outerDoors: [{ a: 0, w: 4.5 }, { a: 90, w: 4.5 }],
  tunnelDoor: 20,
  dims: { o0: 14, o1: 18, e0: 19.5, e1: 26.5, c0: 19.5, c1: 23.5, ow: 1.4, ew: 1.8, cl0: 2.9, cl1: 5.4 },
};

export const OFFICE = { x0: 122, z0: -36, x1: 182, z1: 26, h: 5 };
export const LINAC = { x0: -200, z0: -178, x1: 150, z1: -164, h: 6, femtoX: 115 };
export const PARKING = { x0: 115, z0: 40, x1: 205, z1: 95 };
export const PLAZA = { x0: 112, z0: 26, x1: 195, z1: 40 };
export const TRAM = { z: 168, x0: -900, x1: 640, stopX: 150, essX: 600 };
export const ESS = { x0: 480, z0: -170, x1: 660, z1: 40 };

function roundedRect(x0, z0, x1, z1, r, seg = 8) {
  const pts = [];
  const corners = [[x1 - r, z0 + r, -90], [x1 - r, z1 - r, 0], [x0 + r, z1 - r, 90], [x0 + r, z0 + r, 180]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = (a0 + 90 * i / seg) * Math.PI / 180;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  }
  return pts;
}
// Main ring road (south side = Fotongatan). Closed loop, clockwise on the map.
export const LOOP = roundedRect(-260, -230, 230, 150, 28);

// Straight road segments [x0,z0,x1,z1,width]
export const ROADS = [
  [160, 150, 160, 95, 8],      // spur to parking
  [140, -230, 140, -184, 7],   // linac service road
  [-260, -100, -205, -100, 7], // R1 road
  [-260, 0, -124, 0, 8],       // loading road to west door
  [180, 150, 540, 150, 9],     // Fotongatan east towards ESS
  [-210, 150, -760, 150, 9],   // Fotongatan west towards Lund
];
// Foot / bike paths [x0,z0,x1,z1,width]
export const PATHS = [
  [0, 117, 0, 147, 3],        // south door -> Fotongatan
  [0, -117, 0, -164, 3],      // north door -> linac
  [-121, -4, -121, -96, 3],   // west door -> R1 east door
  [150, 40, 150, 26, 6],      // parking -> office
  [150, 147, 150, 160, 4],    // Fotongatan -> tram stop
  [-160, -60, -160, -50, 3],
  [-160, -50, -121, -50, 3],
];
export const BIKE_RING_R = 123;

// ---------------- Beamlines ----------------
// a = angle (deg) of the source point on the ring; beam travels in +angle direction.
// Order follows the real straight-section numbers (R3:xx / R1:xx): 3 GeV ring 18° per straight, a = -25 + 18·(n-10);
// 1.5 GeV ring 30° per straight, a = 60 + 30·(n-7). Future beamline (straight 7) and the visitor platform (14) are game additions.
export const BEAMLINES3 = [
  { name: 'BALDER', a: -61, color: '#2f7fd0', tech: 'X-ray absorption & emission spectroscopy',
    desc: 'Hard X-ray spectroscopy (XAS/XES) and diffraction, often in situ / operando – catalysts, batteries and materials under real working conditions.' },
  { name: 'BioMAX', a: -7, color: '#1aa6a0', tech: 'Macromolecular crystallography', photo: 'biomax_robot.jpg', photo2: 'biomax_kb_mirror.jpg',
    desc: 'High-throughput protein crystallography. A robot swaps frozen crystals from a liquid-nitrogen dewar so structures of proteins can be solved around the clock.' },
  { name: 'CoSAXS', a: -25, color: '#8a4fd8', tech: 'Coherent small-angle X-ray scattering', visit: true, custom: 'cosaxs', dims: { e1: 61 }, ds: 2.0,
    desc: 'SAXS/WAXS and X-ray photon correlation spectroscopy on soft matter – polymers, colloids, proteins in solution – using the coherence of the ring.' },
  { name: 'DanMAX', visit: true, custom: 'danmax', ds: 3, a: -133, color: '#c8302f', tech: 'Powder diffraction & imaging',
    desc: 'The Danish beamline: powder diffraction and full-field imaging of materials for energy technology, often while they operate.' },
  { name: 'ForMAX', a: -43, color: '#4e9a2c', tech: 'Multiscale structure of bio-based materials',
    desc: 'Combines SAXS/WAXS with tomographic imaging to follow wood, fibres and other forest-based materials from nanometres to millimetres.' },
  { name: 'HIPPIE', a: 101, color: '#d2a21e', tech: 'Ambient-pressure X-ray photoelectron spectroscopy',
    desc: 'Surfaces studied under realistic gas pressures – catalysis, corrosion and electrochemistry “in action”.' },
  { name: 'MicroMAX', a: 11, color: '#2a9fd6', tech: 'Serial & time-resolved crystallography',
    desc: 'Micro-focused beam for serial crystallography: thousands of tiny crystals give movies of proteins at work.' },
  { name: 'NanoMAX', a: -151, color: '#e8742c', tech: 'Hard X-ray nanoprobe', photo: 'nanomax.jpg',
    desc: 'Focuses hard X-rays to spots of a few tens of nanometres for scanning diffraction, fluorescence and coherent imaging. Its orange hutch is a landmark of the hall.' },
  { name: 'SoftiMAX', a: 119, color: '#d14f8f', tech: 'Soft X-ray microscopy',
    desc: 'Scanning transmission X-ray microscopy and coherent imaging with soft X-rays – chemistry mapped at the nanoscale.' },
  { name: 'VERITAS', a: 83, color: '#3b56c4', tech: 'Resonant inelastic X-ray scattering',
    desc: 'High-resolution RIXS revealing the low-energy excitations of quantum materials and molecules.' },
  { name: 'Future beamline', a: -79, color: '#888888', tech: 'Construction site', construction: true,
    desc: 'An empty straight section waiting for its next beamline. Hard hats on!' },
  { name: 'Visitor platform', a: 47, color: '#888888', tech: 'Guided tours', platform: true,
    desc: 'Where tour groups learn that the 3 GeV ring was the first multibend-achromat storage ring in the world.' },
];

export const BEAMLINES1 = [
  { name: 'Bloch', a: 150, color: '#3f6fd6', tech: 'ARPES', desc: 'Angle-resolved photoemission: maps the electronic band structure of quantum materials.' },
  { name: 'FinEstBeAMS', a: 210, color: '#2aa36b', tech: 'Gas-phase & luminescence spectroscopy', desc: 'Finnish–Estonian beamline for atoms, molecules, clusters and luminescent solids with VUV and soft X-rays.' },
  { name: 'FlexPES', a: 60, color: '#d08a20', tech: 'Flexible photoelectron spectroscopy', desc: 'Soft X-ray photoelectron and absorption spectroscopy on surfaces, thin films and molecules.' },
  { name: 'MAXPEEM', a: 180, color: '#b0413e', tech: 'Photoemission electron microscopy', desc: 'PEEM/LEEM imaging of surfaces with chemical and magnetic contrast in real time.' },
  { name: 'SPECIES', a: 90, color: '#7a52c7', tech: 'Ambient-pressure XPS & RIXS', desc: 'Soft X-ray spectroscopy of surfaces in gases and of electronic excitations.' },
];

// ---------------- Photos (Wikimedia Commons and Flickr, Creative Commons licences) ----------------
export const PHOTOS = {
  'aerial_ring_2020.jpg': { cap: 'The MAX IV entrance and the 3 GeV ring building (2020)', by: 'Johan Wessman / News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:20200517_Max_IV_i_Lund_002_(49913522522).jpg' },
  'building_2020b.jpg': { cap: 'Office block and the curved ring hall', by: 'Johan Wessman / News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:20200517_Max_IV_i_Lund_006_(49913223326).jpg' },
  'building_2022.jpg': { cap: 'The vibration-damping wave landscape around the ring', by: 'Johan Wessman / News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:20221105_Max_IV_Lund005_(52479744284).jpg' },
  'hall_2023.jpg': { cap: 'The silver facade of the ring building, 2023', by: 'Johan Wessman / News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:20230503_MAX_IV_Lund_102_(52875848945).jpg' },
  'nanomax.jpg': { cap: 'The orange NanoMAX experimental hutch', by: 'Johan Wessman / News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:20230503_MAX_IV_NanoMax_Lund_082_(52875635224).jpg' },
  'biomax_robot.jpg': { cap: 'BioMAX sample-changer robot and its nitrogen dewar', by: 'XanaG', lic: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:BioMAX-IRELEC-robot.jpg' },
  'biomax_kb_mirror.jpg': { cap: 'BioMAX vacuum tank holding the KB focusing mirrors', by: 'XanaG', lic: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:BioMAX-KBmirror-tank.jpg' },
  'linac.jpg': { cap: 'Accelerating structures of the MAX IV linac', by: 'Synkrotron Lund', lic: 'CC BY-SA 3.0', url: 'https://commons.wikimedia.org/wiki/File:Linacklar.jpg' },
  'r1_ring_inside.jpg': { cap: 'Inside the 1.5 GeV storage ring', by: 'XanaG', lic: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:MAXIV-R1-MBA-cells.jpg' },
  'construction_2013.jpg': { cap: 'MAX IV nearing completion, November 2013', by: 'Joakim Fors', lic: 'CC BY 3.0', url: 'https://commons.wikimedia.org/wiki/File:MAX_IV_2013-11-23.jpg' },
  'layout_ipac2016.jpg': { cap: 'Accelerator layout: 300 m linac, 1.5 GeV ring and 3 GeV ring (Eriksson et al., IPAC 2016)', by: 'M. Eriksson et al.', lic: 'CC BY 3.0', url: 'https://commons.wikimedia.org/wiki/File:MAX_IV_accelerator_layout_-_Figure_1_from_Eriksson_et_al,_Proceedings_IPAC_2016.jpg' },
  'aerial_2016.jpg': { cap: 'Aerial view the day before the inauguration, June 2016 – note the courtyard garden', by: 'Toirelb', lic: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Max_IV-laboratoriet_den_20_juni_2016.jpg' },
  'building_2016.jpg': { cap: 'Main entrance with roundabout and flags, 2016', by: 'Johan Wessman / News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Max_IV_20160620_0154_(27530711930).jpg' },
  'construction_2015a.jpg': { cap: 'The office building during construction, April 2015', by: 'Johan Wessman / News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Max_IV_laboratoriet_Lund_2015apr14_0094_(16949201027).jpg' },
  'construction_2015b.jpg': { cap: 'Building sign, April 2015', by: 'Johan Wessman / News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Max_IV_laboratoriet_Lund_2015apr14_0098_(17130699086).jpg' },
  'magnet_danfysik.jpg': { cap: 'Multibend-achromat magnet blocks being installed', by: 'News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Max_IV_magnet_150206_DSF1919_(26356475391).jpg' },
  'magnet_block.jpg': { cap: 'Integrated magnet block of the 3 GeV ring', by: 'News Øresund', lic: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Max_IV_magnet_20150406_02_(16455367761).jpg' },
  'aerial_2014b.jpg': { cap: 'Aerial view, September 2014 – the courtyard maze garden and the wave landscape taking shape', by: 'David Castor', lic: 'CC0', url: 'https://commons.wikimedia.org/w/index.php?curid=37567445' },
  'construction_2013b.jpg': { cap: 'MAX IV under construction outside Lund, October 2013', by: 'News Øresund', lic: 'CC BY 2.0', url: 'https://www.flickr.com/photos/88883738@N02/10090172084' },
  'quadrupole_evenkolder.jpg': { cap: 'A quadrupole magnet with its copper coils, up close', by: 'evenkolder', lic: 'CC BY 2.0', url: 'https://www.flickr.com/photos/20035421@N00/35248134085' },
  'beamline_evenkolder.jpg': { cap: 'Looking down a MAX IV beamline', by: 'evenkolder', lic: 'CC BY 2.0', url: 'https://www.flickr.com/photos/20035421@N00/34404247014' },
  'brunnshog_2017.jpg': { cap: 'Brunnshög – the new district growing around MAX IV and ESS, 2017', by: 'News Øresund', lic: 'CC BY 2.0', url: 'https://www.flickr.com/photos/88883738@N02/37093341311' },
  'infomastern_1.jpg': { cap: 'MAX IV across the grassy wave landscape at sunset', by: 'Infomastern', lic: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/55856449@N04/29554443004' },
  'infomastern_2.jpg': { cap: 'The silver ring building half-hidden behind the waves', by: 'Infomastern', lic: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/55856449@N04/28597271804' },
  'infomastern_3.jpg': { cap: 'Office block with its horizontal window bands next to the ring', by: 'Infomastern', lic: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/55856449@N04/30427175035' },
  'aerial_2014.jpg': { cap: 'Aerial view across the Skåne fields, September 2014', by: 'David Castor', lic: 'CC0', url: 'https://commons.wikimedia.org/wiki/File:Max_IV%E2%80%93flygbild_06_september_2014.jpg' },
};

export const PHRASES = {
  idle: ['Hej hej!', 'My beamtime starts in 10 minutes!', 'Has anyone seen my sample dewar?', 'The emittance is so low today', 'Fika at three?',
    "Don't run in the experimental hall!", 'Top-up in a few minutes', 'My crystals did not diffract…', 'Is the beam back yet?',
    'Lagom is the best amount of photons', 'Did you do your radiation training?', 'Who left the LN2 dewar here?', 'Brightest light in Sweden!',
    'I only slept 2 hours, beamtime life', 'Need more kanelbullar', 'Detector is saturating again', 'Shift change at 8'],
  hit: ['Aj!', 'Watch it!', "I'm calling safety!", 'Not lagom!', 'My samples!!', 'Hey! Bikes only in here!', 'Seriously?!'],
  officer: ['Stop! Radiation safety!', 'You need more training!', 'Badge, please!', 'Halt! Interlock violation!'],
  angry: ['Who dumped the beam?!', 'My beamtime is ruined!', 'NOOO, the beam!', 'Twelve months waiting for this shift…'],
};
