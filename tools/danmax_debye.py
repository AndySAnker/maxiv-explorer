"""DanMAX powder diffraction / PDF data with DebyeCalculator (grid pair sum, PR #44) -> js/danmax_data.js

For every sample: I(Q) with self-scattering, the self-scattering curve (to normalise measured data into S(Q)),
averaged over a few crystallite sizes, and the reference G(r) from DebyeCalculator.
For the r-space analysis: F(Q) of candidate structures (the game Fourier-transforms them with your Qmax).

    PYTHONPATH=<DebyeCalculator checkout> python3 tools/danmax_debye.py
"""
import json, pathlib, sys, time
import numpy as np
from ase import Atoms
from ase.build import bulk
from ase.spacegroup import crystal
from ase.cluster import Icosahedron, Decahedron
import debyecalculator
from debyecalculator import DebyeCalculator

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from cosaxs_debye import fluorite_cubic, lab6_cubic  # noqa: E402


def sphere(unit, r_nm):
    """Cut a sphere from a big enough block of any (also non-orthogonal) unit cell."""
    r = r_nm * 10.0
    n = int(np.ceil(2.8 * r / min(unit.cell.lengths()))) + 2
    big = unit.repeat((n, n, n)); pos = big.get_positions(); pos -= pos.mean(axis=0)
    m = np.einsum('ij,ij->i', pos, pos) <= r * r
    return Atoms(np.array(big.get_chemical_symbols())[m].tolist(), positions=pos[m])


def centred(atoms):
    a = atoms.copy(); a.positions -= a.positions.mean(axis=0); return a


AU = bulk('Au', 'fcc', a=4.078, cubic=True)
NI = bulk('Ni', 'fcc', a=3.524, cubic=True)
ANATASE = crystal(['Ti', 'O'], basis=[(0, 0, 0), (0, 0, 0.2081)], spacegroup=141, setting=1, cellpar=[3.7845, 3.7845, 9.5143, 90, 90, 90])
RUTILE = crystal(['Ti', 'O'], basis=[(0, 0, 0), (0.3049, 0.3049, 0)], spacegroup=136, cellpar=[4.594, 4.594, 2.959, 90, 90, 90])

SAMPLES = [
    dict(id='au', name='Gold nanoparticles', formula='Au', color='#e0b33c', shape='≈ 3 nm, fcc',
         desc='Tiny gold particles: broad Bragg peaks in Q, a PDF that dies out after ~3 nm.', unit=AU, sizes=[1.3, 1.5, 1.7]),
    dict(id='tio2', name='Titania nanocrystals', formula='TiO₂', color='#e8eef2', shape='≈ 6 nm, anatase',
         desc='Anatase TiO₂, a photocatalyst. Ti–O at 1.95 Å and Ti–Ti at ~3 Å stand out in the PDF.', unit=ANATASE, sizes=[2.6, 3.0, 3.4]),
    dict(id='ni', name='Nickel powder', formula='Ni', color='#9aa3ab', shape='≈ 8 nm crystallites, fcc',
         desc='Well-crystalline fcc metal: sharp peaks to high Q and PDF peaks far out in r.', unit=NI, sizes=[3.6, 4.0, 4.4]),
    dict(id='ceo2', name='Ceria standard', formula='CeO₂', color='#f1ead2', shape='calibrant, a = 5.411 Å', std=True, a=5.411, lattice='fcc',
         desc='The common PXRD line-position standard (NIST 674-type).', unit=fluorite_cubic(5.411), sizes=[5.0]),
    dict(id='lab6', name='Lanthanum hexaboride standard', formula='LaB₆', color='#7f6a9c', shape='calibrant, a = 4.1569 Å', std=True, a=4.1569, lattice='cubic',
         desc='Cubic line-position standard (NIST 660-type).', unit=lab6_cubic(4.1569), sizes=[5.0]),
]

CANDIDATES = {
    'au': [('fcc sphere, d = 3 nm', lambda: sphere(AU, 1.5)), ('fcc sphere, d = 5 nm', lambda: sphere(AU, 2.5)),
           ('Icosahedron (561 atoms)', lambda: centred(Icosahedron('Au', noshells=6, latticeconstant=4.078))),
           ('Decahedron (559 atoms)', lambda: centred(Decahedron('Au', p=6, q=2, r=1, latticeconstant=4.078)))],
    'tio2': [('Anatase, d = 6 nm', lambda: sphere(ANATASE, 3.0)), ('Rutile, d = 6 nm', lambda: sphere(RUTILE, 3.0)), ('Anatase, d = 3 nm', lambda: sphere(ANATASE, 1.5))],
    'ni': [('fcc Ni, d = 8 nm', lambda: sphere(NI, 4.0)), ('hcp Ni, d = 8 nm', lambda: sphere(bulk('Ni', 'hcp', a=2.49, c=4.07), 4.0)),
           ('bcc Ni, d = 8 nm', lambda: sphere(bulk('Ni', 'bcc', a=2.81, cubic=True), 4.0))],
}


def viewer(atoms, rng, vmax=700):
    pos = atoms.get_positions(); el = atoms.get_chemical_symbols()
    idx = np.arange(len(atoms)) if len(atoms) <= vmax else rng.choice(len(atoms), vmax, replace=False)
    pos = pos[idx] - pos.mean(axis=0)
    return {'el': [el[i] for i in idx], 'xyz': [round(float(v), 2) for v in pos.ravel()]}


def g5(a): return [float(f'{v:.5g}') for v in a]


def main():
    rng = np.random.default_rng(3)
    calc = DebyeCalculator(qmin=0.3, qmax=25.0, qstep=0.01, rmin=0.0, rmax=30.0, rstep=0.02, biso=0.4, qdamp=0.02,
                           device='cpu', radiation_type='xray', pair_sum='grid')
    out = {'meta': {'debyecalculator': getattr(debyecalculator, '__version__', '1.1.1'), 'pair_sum': 'grid'}, 'samples': []}
    for s in SAMPLES:
        sizes = np.array(s['sizes']); w = np.exp(-0.5 * ((sizes - sizes.mean()) / (sizes.std() + 1e-9)) ** 2) if len(sizes) > 1 else np.ones(1)
        w /= w.sum(); I = SS = G = None; natoms = []; t0 = time.time()
        for size, wi in zip(sizes, w):
            at = sphere(s['unit'], size); natoms.append(len(at))
            q, i_all = calc.iq(at); _, i_dist = calc.iq(at, include_self_scattering=False)
            r, g = calc.gr(at)
            I = wi * i_all if I is None else I + wi * i_all
            SS = wi * (i_all - i_dist) if SS is None else SS + wi * (i_all - i_dist)
            G = wi * g if G is None else G + wi * g
        c = float(SS[q > 15].mean())
        out['q'] = [round(float(x), 3) for x in q]; out['r'] = [round(float(x), 3) for x in r]
        u = s['unit']; cl = u.cell.lengths()
        cell = {'a': round(float(cl[0]), 5), 'c': round(float(cl[2]), 5), 'tetra': bool(abs(cl[2] - cl[0]) > 1e-3),
                'basis': [[e, *[round(float(x), 4) for x in f]] for e, f in zip(u.get_chemical_symbols(), u.get_scaled_positions())],
                'D': round(2 * float(np.dot(w, sizes)), 2)}
        out['samples'].append({k: s[k] for k in ('id', 'name', 'formula', 'color', 'shape', 'desc', 'std', 'a', 'lattice') if k in s}
                              | {'atoms': natoms, 'I': g5(I / c), 'SS': g5(SS / c), 'G': g5(G), 'cell': cell})
        print(f"{s['name']}: {natoms} atoms, {time.time() - t0:.1f} s")
    calc2 = DebyeCalculator(qmin=0.5, qmax=25.0, qstep=0.02, biso=0.4, qdamp=0.02, device='cpu', radiation_type='xray', pair_sum='grid')
    out['cand'] = {}
    for key, lst in CANDIDATES.items():
        res = []
        for label, make in lst:
            at = make(); q2, f = calc2.fq(at)
            res.append({'label': label, 'natoms': len(at), 'formula': at.get_chemical_formula(mode='hill'), 'F': g5(f)} | viewer(at, rng))
            print(f'  {label}: {len(at)} atoms')
        out['cand'][key] = res
    out['qf'] = [round(float(x), 3) for x in q2]
    (ROOT / 'js/danmax_data.js').write_text('// generated by tools/danmax_debye.py with DebyeCalculator (grid pair sum)\nexport const DANMAX = ' + json.dumps(out, ensure_ascii=False) + ';\n')
    print('wrote js/danmax_data.js')


if __name__ == '__main__':
    main()
