"""Compute the CoSAXS sample scattering patterns with DebyeCalculator and write js/cosaxs_data.js.

Uses the grid pair sum from DebyeCalculator PR #44 ("Faster Debye sum, larger particles", v1.1.x):
    pip install git+https://github.com/FrederikLizakJohansen/DebyeCalculator
    python3 tools/cosaxs_debye.py

Three nanoparticle samples are built with ASE. Each pattern is a number-weighted average over a few
particle sizes (a little polydispersity smooths the SAXS fringes like in a real measurement).
"""
import json, pathlib, time
import numpy as np
from ase.build import bulk
from ase import Atoms
import debyecalculator
from debyecalculator import DebyeCalculator

ROOT = pathlib.Path(__file__).resolve().parent.parent
QMIN, QMAX, QSTEP = 0.002, 5.0, 0.002  # 1/Å – covers SAXS (far detector) to WAXS (close detector)


def fluorite_cubic(a):
    fcc = [(0, 0, 0), (0, .5, .5), (.5, 0, .5), (.5, .5, 0)]
    o = [(x, y, z) for x in (.25, .75) for y in (.25, .75) for z in (.25, .75)]
    return Atoms(['Ce'] * 4 + ['O'] * 8, scaled_positions=fcc + o, cell=[a, a, a], pbc=True)


def cut(unit, keep, reps):
    """Repeat a unit cell, centre it, and keep the atoms for which keep(xyz) is True."""
    big = unit.repeat(reps)
    pos = big.get_positions()
    pos -= pos.mean(axis=0)
    m = keep(pos)
    return Atoms(np.array(big.get_chemical_symbols())[m].tolist(), positions=pos[m])


def sphere(unit, r_nm):
    r = r_nm * 10.0
    n = int(np.ceil(2 * r / min(unit.cell.lengths()))) + 2
    return cut(unit, lambda p: np.einsum('ij,ij->i', p, p) <= r * r, (n, n, n))


def rod(unit, r_nm, length_nm):
    r, h = r_nm * 10.0, length_nm * 10.0
    a, _, c = unit.cell.lengths()
    n, m = int(np.ceil(2.6 * r / a)) + 2, int(np.ceil(h / c)) + 2
    return cut(unit, lambda p: (p[:, 0] ** 2 + p[:, 1] ** 2 <= r * r) & (np.abs(p[:, 2]) <= h / 2), (n, n, m))


def lab6_cubic(a):
    x = 0.1996  # B 6f position
    b = [(x, .5, .5), (1 - x, .5, .5), (.5, x, .5), (.5, 1 - x, .5), (.5, .5, x), (.5, .5, 1 - x)]
    return Atoms(['La'] + ['B'] * 6, scaled_positions=[(0, 0, 0)] + b, cell=[a, a, a], pbc=True)


def agbeh_stack(r_nm, layers, d=58.38, a=4.3):
    """Simplified silver behenate: silver bilayers on a 2D hexagonal net, stacked with the 58.38 Å long period.
    The hydrocarbon chains between the silver layers are left out – they scatter weakly compared to Ag."""
    r = r_nm * 10.0; n = int(r / a) + 2; pts = []
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            x, y = a * (i + 0.5 * j), a * 0.8660254 * j
            if x * x + y * y <= r * r: pts.append((x, y))
    pts = np.array(pts); pos = []
    for k in range(layers):
        z0 = (k - (layers - 1) / 2) * d
        for dz in (-1.4, 1.4):
            pos.append(np.column_stack([pts, np.full(len(pts), z0 + dz)]))
    pos = np.vstack(pos)
    return Atoms(['Ag'] * len(pos), positions=pos)


SAMPLES = [
    dict(id='au', name='Gold nanoparticles', formula='Au', color='#e0b33c', shape='spheres, d ≈ 5 nm',
         desc='Citrate-stabilised gold spheres. Strong contrast gives clear SAXS fringes from the particle size, and fcc Bragg peaks (111), (200), (220) at wide angles.',
         unit=bulk('Au', 'fcc', a=4.078, cubic=True), sizes=[2.1, 2.3, 2.5, 2.7, 2.9], make=sphere),
    dict(id='ceo2', name='Cerium oxide nanoparticles', formula='CeO₂', color='#f1ead2', shape='spheres, d ≈ 6 nm',
         desc='Fluorite-structured CeO₂, a classic catalyst support. Larger particles move the SAXS fringes to lower q; the fluorite lattice gives its own set of Bragg peaks.',
         unit=fluorite_cubic(5.411), sizes=[2.5, 2.75, 3.0, 3.25, 3.5], make=sphere),
    dict(id='zno', name='Zinc oxide nanorods', formula='ZnO', color='#b9d7e8', shape='rods, d ≈ 3 nm, L ≈ 9 nm',
         desc='Wurtzite ZnO rods. The elongated shape gives a q⁻¹ slope in the SAXS region instead of the flat Guinier plateau of spheres; (100), (002), (101) peaks appear at wide angles.',
         unit=bulk('ZnO', 'wurtzite', a=3.250, c=5.207), sizes=[7.0, 8.0, 9.0, 10.0, 11.0], make=lambda u, L: rod(u, 1.5, L)),
    # calibration standards
    dict(id='agbeh', name='Silver behenate standard', formula='AgBeH', color='#cfd3d8', shape='lamellar powder, d₀₀₁ = 58.38 Å', std='saxs',
         peaks=[0.10763 * n for n in range(1, 8)],
         desc='The classic SAXS calibrant: a lamellar soap whose long period gives sharp rings at q = n·0.1076 Å⁻¹. Use it to calibrate long sample–detector distances.',
         unit=None, sizes=[11, 12, 13], make=lambda u, L: agbeh_stack(7.0, int(L))),
    dict(id='lab6', name='Lanthanum hexaboride standard', formula='LaB₆', color='#7f6a9c', shape='powder (NIST SRM 660 type), a = 4.1569 Å', std='waxs',
         peaks=[1.5115, 2.1376, 2.6181, 3.0231, 3.3800, 3.7026],
         desc='The WAXS line-position standard: a cubic powder with many sharp Bragg peaks. Use it to calibrate short sample–detector distances.',
         unit=lab6_cubic(4.1569), sizes=[4.0, 4.6, 5.2], make=sphere),
]


def main():
    calc = DebyeCalculator(qmin=QMIN, qmax=QMAX, qstep=QSTEP, biso=0.5, device='cpu', radiation_type='xray', pair_sum='grid')
    out = {'q': None, 'samples': [], 'meta': {'debyecalculator': getattr(debyecalculator, '__version__', '1.1.1'), 'pair_sum': 'grid', 'qstep': QSTEP}}
    for s in SAMPLES:
        sizes = np.array(s['sizes'])
        w = np.exp(-0.5 * ((sizes - sizes.mean()) / (0.45 * sizes.std() * 2)) ** 2)
        w /= w.sum()
        total, natoms, t0 = None, [], time.time()
        for size, wi in zip(sizes, w):
            atoms = s['make'](s['unit'], size)
            natoms.append(len(atoms))
            q, i = calc.iq(atoms)
            total = wi * i if total is None else total + wi * i
        dt = time.time() - t0
        print(f"{s['name']}: {natoms} atoms, {dt:.1f} s")
        out['q'] = [round(float(x), 4) for x in q]
        out['samples'].append({k: s[k] for k in ('id', 'name', 'formula', 'color', 'shape', 'desc', 'std', 'peaks') if k in s} | {
            'atoms': natoms, 'seconds': round(dt, 1),
            'I': [float(f'{v:.5g}') for v in total]})
    (ROOT / 'js/cosaxs_data.js').write_text('// generated by tools/cosaxs_debye.py with DebyeCalculator (grid pair sum)\nexport const COSAXS = ' + json.dumps(out, ensure_ascii=False) + ';\n')
    print('wrote js/cosaxs_data.js')


if __name__ == '__main__':
    main()
