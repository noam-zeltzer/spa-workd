"""Synthesises the reel's soundtrack from nothing but NumPy.

120 BPM, D minor resolving to D major on the logo. Every sound-design cue is
placed on the same timeline the picture uses (index.html), so impacts, whooshes,
flips and bells land on the frame that causes them.

    python3 tools/soundtrack.py out.wav
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 15.0
N = int(SR * DUR)
rng = np.random.default_rng(2026)

dry = np.zeros((2, N))
send = np.zeros((2, N))   # reverb send
duck = np.ones(N)         # sidechain gain, written by the kick


# ---------------------------------------------------------------- utilities
def tt(n):
    return np.arange(n) / SR


def place(sig, t0, gain=1.0, pan=0.0, verb=0.0):
    """Mix a mono or stereo signal in at t0 seconds (equal-power pan)."""
    sig = np.asarray(sig, float)
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.vstack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
    i0 = int(round(t0 * SR))
    if i0 < 0:
        sig = sig[:, -i0:]
        i0 = 0
    n = min(sig.shape[1], N - i0)
    if n <= 0:
        return
    dry[:, i0:i0 + n] += sig[:, :n] * gain
    if verb:
        send[:, i0:i0 + n] += sig[:, :n] * gain * verb


def fade(sig, a=0.002, r=0.01):
    n = len(sig)
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    env = np.ones(n)
    env[:na] = np.linspace(0, 1, na) if na < n else 1
    env[-nr:] *= np.linspace(1, 0, min(nr, n))
    return sig * env


def fft_filter(x, kind, fc, order=2, fc2=None):
    """Static zero-phase filter (Butterworth-shaped magnitude)."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR) + 1e-6
    if kind == 'lp':
        H = 1 / np.sqrt(1 + (f / fc) ** (2 * order))
    elif kind == 'hp':
        H = 1 / np.sqrt(1 + (fc / f) ** (2 * order))
    else:  # band
        H = 1 / np.sqrt(1 + (fc / f) ** (2 * order)) / np.sqrt(1 + (f / fc2) ** (2 * order))
    return np.fft.irfft(X * H, n)


def svf(x, fc, q=0.8, mode='bp'):
    """Time-varying TPT state-variable filter; fc may be an array (Hz)."""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    g = np.tan(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
    k = 1.0 / q
    a1 = 1 / (1 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    out = np.empty_like(x)
    s1 = s2 = 0.0
    for n in range(len(x)):
        v3 = x[n] - s2
        v1 = a1[n] * s1 + a2[n] * v3
        v2 = s2 + a2[n] * s1 + a3[n] * v3
        s1 = 2 * v1 - s1
        s2 = 2 * v2 - s2
        out[n] = v1 if mode == 'bp' else v2 if mode == 'lp' else x[n] - k * v1 - v2
    return out


def expsweep(f0, f1, n, curve=1.0):
    u = np.linspace(0, 1, n) ** curve
    return f0 * (f1 / f0) ** u


def noise(n):
    return rng.standard_normal(n)


def saw(freq, n, detune=0.0):
    ph = np.cumsum(np.broadcast_to(freq * (1 + detune), (n,))) / SR
    ph += rng.random()
    return 2 * (ph % 1.0) - 1


NOTE = {'C': -9, 'C#': -8, 'D': -7, 'Eb': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'Ab': -1, 'A': 0, 'Bb': 1, 'B': 2}


def hz(name):
    """'D3' -> frequency."""
    p, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[p] + 12 * (o - 4)) / 12)


# ---------------------------------------------------------------- instruments
def kick(dur=0.42, f0=165, f1=47, drive=1.8):
    n = int(dur * SR); t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    click = fft_filter(noise(n), 'band', 1500, 2, 6000) * np.exp(-t / 0.004) * 0.5
    return fade(np.tanh((body + click) * drive) / np.tanh(drive), 0.0005, 0.02)


def clap():
    n = int(0.45 * SR); t = tt(n)
    env = np.zeros(n)
    for d in (0, 0.009, 0.018):
        env += (t >= d) * np.exp(-np.maximum(t - d, 0) / 0.006)
    env += (t >= 0.024) * np.exp(-np.maximum(t - 0.024, 0) / 0.13) * 0.7
    s = fft_filter(noise(n), 'band', 900, 2, 4200) * env
    s += np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.4
    return fade(s, 0.0005, 0.03)


def hat(open_=False):
    n = int((0.25 if open_ else 0.07) * SR); t = tt(n)
    s = fft_filter(noise(n), 'hp', 7500, 3) * np.exp(-t / (0.09 if open_ else 0.022))
    return fade(s, 0.0003, 0.01)


def tick(f=4000):
    n = int(0.02 * SR); t = tt(n)
    return fade(fft_filter(noise(n), 'band', f * 0.7, 2, f * 1.4) * np.exp(-t / 0.0025), 0.0002, 0.004)


def blip(f=1500, dur=0.09):
    n = int(dur * SR); t = tt(n)
    ff = f * (1 + 0.25 * (1 - np.exp(-t / 0.01)))
    return fade(np.sin(2 * np.pi * np.cumsum(ff) / SR) * np.exp(-t / 0.03), 0.0005, 0.01)


def bell(f, dur=1.6, idx=2.6, ratio=3.5):
    n = int(dur * SR); t = tt(n)
    I = idx * np.exp(-t / 0.18)
    s = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * ratio * t)) * np.exp(-t / (dur * 0.35))
    s += 0.25 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.25)
    return fade(s, 0.001, 0.05)


def pluck(f, dur=0.5, bright=1.0):
    n = int(dur * SR); t = tt(n)
    s = np.zeros(n)
    for k in range(1, 11):
        if f * k > SR * 0.4:
            break
        s += np.sin(2 * np.pi * f * k * t + k) / k * np.exp(-t * (4 + k * 3.2 / bright))
    return fade(s * 0.6, 0.001, 0.03)


def tom(f0=110, dur=0.4):
    n = int(dur * SR); t = tt(n)
    f = f0 * (1 + 0.8 * np.exp(-t / 0.03)) * (1 + 0.04 * np.sin(2 * np.pi * 9 * t) * np.exp(-t / 0.1))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13)
    s += fft_filter(noise(n), 'lp', 900) * np.exp(-t / 0.015) * 0.3
    return fade(np.tanh(s * 1.4), 0.0005, 0.03)


def boom(dur=2.2, f0=72, f1=34):
    n = int(dur * SR); t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.25)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.75)
    s += fft_filter(noise(n), 'lp', 220, 2) * np.exp(-t / 0.5) * 0.6
    k = kick(0.3, 220, 60, 2.5)[:n]
    s[:len(k)] += k
    return fade(np.tanh(s * 1.5), 0.0005, 0.2)


def crash(dur=2.0):
    n = int(dur * SR); t = tt(n)
    s = fft_filter(noise(n), 'hp', 3200, 2) * np.exp(-t / 0.6)
    for k, fr in enumerate((3120, 4410, 5230, 6890, 8120)):
        s += 0.05 * np.sin(2 * np.pi * fr * t + k) * np.exp(-t / 0.4)
    return fade(s, 0.0005, 0.3)


def whoosh(dur, f0, f1, peak=0.5, q=1.2, curve=1.0):
    n = int(dur * SR); u = np.linspace(0, 1, n)
    env = np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.6)
    x = noise(n)
    l = svf(x, expsweep(f0, f1, n, curve), q, 'bp') * env
    r = svf(np.roll(x, 211), expsweep(f0 * 1.06, f1 * 1.06, n, curve), q, 'bp') * env
    return np.vstack([l, r])


def riser(dur, f0=300, f1=7000, tone=(110, 440)):
    n = int(dur * SR); u = np.linspace(0, 1, n)
    env = u ** 2.2
    s = svf(noise(n), expsweep(f0, f1, n), 1.5, 'bp') * env
    fr = expsweep(tone[0], tone[1], n)
    s += 0.18 * fft_filter(saw(fr, n) + saw(fr, n, 0.006), 'lp', 3000) * env
    return fade(s, 0.01, 0.004)


def reverse_crash(dur=0.9):
    return fade(crash(dur + 0.4)[::-1][-int(dur * SR):] * 0.9, 0.05, 0.004)


def chord_pad(notes, dur, attack=0.35, release=0.5, cutoff=1400):
    n = int(dur * SR); t = tt(n)
    s = np.zeros(n)
    for nm in notes:
        f = hz(nm)
        for d in (-0.0045, 0.0, 0.0052):
            s += saw(f, n, d)
    s = fft_filter(s / (len(notes) * 3), 'lp', cutoff, 2)
    env = np.minimum(1, t / attack) * np.minimum(1, np.maximum(0, (dur - t) / release))
    return s * env


# ---------------------------------------------------------------- the score
BEAT = 0.5
VERB_TAIL = 1.8

# 0.00 – 1.00  KEYFRAME: a clock, a line, a gem, a playhead
for k in range(16):
    tm = 0.0625 * k
    place(tick(5200 if k % 4 else 3800), tm, 0.05 + 0.1 * (k / 16), pan=0.3 if k % 2 else -0.3)
n = int(0.55 * SR)
zip_ = np.sin(2 * np.pi * np.cumsum(expsweep(320, 2600, n, 0.7)) / SR) * np.sin(np.linspace(0, np.pi, n)) ** 2
place(fade(zip_), 0.08, 0.05, verb=0.3)
place(bell(hz('A5'), 1.4), 0.22, 0.2, verb=0.5)
for k, (tm, f) in enumerate([(0.30, 1300), (0.35, 1500), (0.37, 1700), (0.42, 1900)]):
    place(blip(f), tm, 0.12, pan=(-0.6, 0.6, -0.35, 0.35)[k], verb=0.3)
for i in range(8):
    place(tick(2800 + i * 260), 0.36 + i * 0.03, 0.11, pan=-0.5 + i / 7)
place(bell(hz('D6'), 1.2, 1.6), 0.74, 0.16, verb=0.6)
place(whoosh(0.4, 400, 5200, 0.92, 1.4, 1.4), 0.62, 0.32)
place(reverse_crash(0.5), 0.5, 0.18)
sub_n = int(1.0 * SR)
place(np.sin(2 * np.pi * hz('D2') * tt(sub_n)) * np.linspace(0, 1, sub_n) ** 2 * 0.5, 0.0, 0.3)

# drums 1.0 – 11.5
kick_times = [1.0 + BEAT * k for k in range(21)]          # 1.0 .. 11.0
kick_times += [11.25, 11.375]
for kt in kick_times:
    place(kick(), kt, 0.68 if kt not in (4.0,) else 0.0)
    i0 = int(kt * SR)
    dn = int(0.32 * SR)
    seg = 1 - 0.62 * np.exp(-tt(dn) / 0.09)
    duck[i0:i0 + dn] = np.minimum(duck[i0:i0 + dn], seg[:max(0, min(dn, N - i0))])
for k in range(10):
    ct = 1.5 + k * 1.0
    if ct < 11.5:
        place(clap(), ct, 0.32, verb=0.35)
for k in range(42):
    ht = 1.0 + k * 0.25
    if ht >= 11.5:
        break
    off = (k % 2 == 1)
    place(hat(open_=off and k % 4 == 3), ht, 0.11 if off else 0.05, pan=0.25 if off else -0.2)
for k in range(80):  # 16th ghost hats from the cloner on
    ht = 6.0 + k * 0.125
    if ht >= 11.5:
        break
    if k % 2:
        place(hat(), ht, 0.035, pan=0.45)

# harmony: Dm | Bb | F | C | Dm, then a lift into the logo
PROG = [(1.0, ['D3', 'F3', 'A3', 'D4']), (3.0, ['Bb2', 'D3', 'F3', 'Bb3']), (5.0, ['F2', 'A3', 'C4', 'F3']),
        (7.0, ['C3', 'E3', 'G3', 'C4']), (9.0, ['D3', 'F3', 'A3', 'D4']), (10.5, ['Bb2', 'D3', 'F3', 'A3'])]
ROOTS = {1.0: 'D2', 3.0: 'Bb1', 5.0: 'F2', 7.0: 'C2', 9.0: 'D2', 10.5: 'Bb1'}
pad_bus = np.zeros((2, N))
for idx, (t0, notes) in enumerate(PROG):
    t1 = PROG[idx + 1][0] if idx + 1 < len(PROG) else 11.5
    p = chord_pad(notes, t1 - t0 + 0.3, 0.25, 0.35, 1200 if t0 < 4 else 1700)
    i0 = int(t0 * SR); nn = min(len(p), N - i0)
    pad_bus[0, i0:i0 + nn] += p[:nn]
    pad_bus[1, i0:i0 + nn] += np.roll(p, 37)[:nn]
# bass: rolling 8ths on the root
bass_bus = np.zeros(N)
for idx, t0 in enumerate(sorted(ROOTS)):
    t1 = sorted(ROOTS)[idx + 1] if idx + 1 < len(ROOTS) else 11.5
    f = hz(ROOTS[t0])
    k = 0
    while t0 + k * 0.25 < t1 - 0.01:
        st = t0 + k * 0.25
        n = int(0.24 * SR); t = tt(n)
        s = 0.6 * np.sin(2 * np.pi * f * t) + 0.4 * fft_filter(saw(f, n) + saw(f * 2, n, 0.003) * 0.4, 'lp', 520 + 500 * np.exp(-0), 2)
        s *= np.exp(-t / 0.16)
        s = fade(s, 0.002, 0.02)
        i0 = int(st * SR); nn = min(n, N - i0)
        bass_bus[i0:i0 + nn] += s[:nn] * (1.0 if k % 2 else 0.75)
        k += 1
dry += pad_bus * duck * 0.12
send += pad_bus * duck * 0.05
dry += np.vstack([bass_bus, bass_bus]) * duck * 0.26

# 1.00  EASE
place(boom(1.2, 90, 40), 1.0, 0.5, verb=0.2)
place(crash(1.2), 1.0, 0.08, verb=0.4)
for i in range(4):
    place(whoosh(0.62, 300, 2400, 0.5, 1.6), 1.12 + i * 0.075, 0.16, pan=-0.7 + i * 0.45)
place(bell(hz('F5'), 0.8, 1.2), 1.12, 0.07, verb=0.6)
# whip pan
place(whoosh(0.3, 5000, 700, 0.55, 1.2, 0.8), 1.76, 0.42)
# STAGGER card flips (the two waves) and the collapse
for i in range(46):
    d = rng.random() * 0.36
    place(tick(2200 + rng.random() * 3000), 1.84 + d + 0.12, 0.06, pan=rng.uniform(-0.8, 0.8))
    d = rng.random() * 0.36
    place(tick(1800 + rng.random() * 2500), 2.36 + d * 0.6 + 0.08, 0.055, pan=rng.uniform(-0.8, 0.8))
place(whoosh(0.28, 3000, 300, 0.85, 1.4), 2.72, 0.3)
# SQUASH & STRETCH
place(whoosh(0.26, 600, 1800, 0.95, 1.6, 1.0), 3.0, 0.14)
for tm, f0, g in [(3.25, 105, 0.75), (3.62, 125, 0.5), (3.86, 145, 0.32)]:
    place(tom(f0), tm, g, verb=0.25)
place(whoosh(0.16, 900, 6000, 0.96, 1.2, 1.4), 3.84, 0.4)
place(reverse_crash(0.35), 3.65, 0.25)
# 4.00  EXTRUDE: the big hit, the extrusion, the light sweep, the crane
place(boom(2.4, 78, 34), 4.0, 1.25, verb=0.3)
place(crash(2.2), 4.0, 0.16, verb=0.6)
n = int(1.1 * SR); t = tt(n)
rumble = fft_filter(saw(np.full(n, 41.2), n) + saw(np.full(n, 41.2), n, 0.01), 'lp', 260)
rumble *= np.sin(np.linspace(0, np.pi, n)) ** 1.5
place(rumble, 4.08, 0.3)
place(whoosh(0.9, 250, 900, 0.45, 2.0), 4.1, 0.22)
n = int(1.0 * SR)
shimmer = fft_filter(noise(n), 'band', 5000, 2, 11000) * np.sin(np.linspace(0, np.pi, n)) ** 2
place(np.vstack([shimmer, np.roll(shimmer, 900)]), 4.35, 0.05, verb=0.6)
place(whoosh(0.62, 200, 4200, 0.75, 1.0, 1.2), 5.38, 0.38)
# 6.00  CLONER: the ripple, the letters, the bounces
for i in range(70):
    tm = 5.95 + (i / 70) ** 0.8 * 0.75
    place(tick(1500 + rng.random() * 4500), tm, 0.05 + 0.04 * rng.random(), pan=rng.uniform(-0.9, 0.9))
place(blip(420, 0.25), 5.95, 0.2, verb=0.4)
scale = ['D4', 'F4', 'A4', 'C5', 'D5', 'F5', 'A5', 'C6']
for k, nm in enumerate(scale):
    place(pluck(hz(nm), 0.6), 6.68 + k * 0.05, 0.12, pan=-0.7 + k * 0.2, verb=0.5)
for k in range(16):  # 16th arp over F | C
    nm = ['F4', 'A4', 'C5', 'A4'][k % 4] if k < 8 else ['E4', 'G4', 'C5', 'G4'][k % 4]
    place(pluck(hz(nm), 0.3, 0.7), 6.0 + k * 0.125, 0.05, pan=0.5 if k % 2 else -0.5, verb=0.3)
for bt in (7.0, 7.5):
    place(tom(160, 0.25), bt, 0.25, verb=0.2)
place(riser(0.45, 400, 6000, (220, 660)), 7.55, 0.22)
# 8.00  PARALLAX
place(boom(1.0, 95, 45), 8.0, 0.45, verb=0.3)
place(whoosh(0.45, 600, 2600, 0.5, 1.6), 8.12, 0.12, pan=-0.6)
place(whoosh(0.45, 700, 3000, 0.5, 1.6), 8.42, 0.12, pan=0.6)
place(whoosh(0.34, 300, 5200, 0.97, 1.1, 1.6), 8.66, 0.42)
# 9.00  MORPH: pops, clacks, flips
for i in range(24):
    d = (rng.random() ** 0.7) * 0.15
    place(blip(700 + rng.random() * 900, 0.05), 8.99 + d, 0.05, pan=rng.uniform(-0.8, 0.8))
for bt in (9.25, 9.5, 9.75):
    for j in range(7):
        place(tick(900 + j * 220), bt + j * 0.018, 0.12 - j * 0.012, pan=-0.6 + j * 0.2)
    place(blip(560 if bt != 9.5 else 680, 0.07), bt, 0.12)
for j in range(20):
    place(tick(1600 + j * 120), 9.82 + j * 0.009, 0.07, pan=-0.9 + j * 0.09)
# 10.00  LOOP: riser, roll, inversions
place(riser(1.5, 250, 9000, (110, 880)), 10.0, 0.3)
for tm in (10.5, 11.0, 11.25, 11.375):
    place(crash(0.35), tm, 0.12)
    place(blip(880, 0.12), tm, 0.1, verb=0.4)
roll = [10.75 + k * 0.125 for k in range(4)] + [11.25 + k * 0.0625 for k in range(4)]
for k, tm in enumerate(roll):
    place(clap(), tm, 0.12 + 0.025 * k, verb=0.25)
place(reverse_crash(0.3), 11.2, 0.3)
# 11.50  TIMING: one stab per cut, each a step higher
STABS = [11.5, 11.75, 12.0, 12.125, 12.25, 12.3125, 12.375, 12.4375]
stab_roots = ['D3', 'E3', 'F3', 'G3', 'A3', 'Bb3', 'C4', 'D4']
for k, tm in enumerate(STABS):
    f = hz(stab_roots[k])
    n = int(0.22 * SR); t = tt(n)
    s = sum(saw(f * r, n, d) for r, d in ((1, 0), (1.5, 0.004), (2, -0.003)))
    s = fade(fft_filter(s, 'lp', 2600, 2) * np.exp(-t / 0.07), 0.001, 0.03)
    place(s, tm, 0.13, verb=0.35)
    place(kick(0.2, 190, 70, 2.2), tm, 0.35)
place(riser(1.0, 500, 11000, (220, 1760)), 11.5, 0.22)
# 12.50  INBETWEEN: the impact, the chord, the tween, the sweep, the bow
place(boom(2.5, 82, 34), 12.5, 1.3, verb=0.35)
place(crash(2.5), 12.5, 0.2, verb=0.7)
place(kick(0.5, 200, 45, 2.6), 12.5, 0.7)
final = chord_pad(['D2', 'A2', 'D3', 'F#3', 'A3', 'E4', 'F#4', 'A4'], 2.45, 0.08, 1.2, 2200)
place(np.vstack([final, np.roll(final, 53)]), 12.5, 0.16, verb=0.5)
for i in range(9):
    place(whoosh(0.5, 400, 3200, 0.55, 1.6), 12.6 + i * 0.05, 0.05, pan=-0.9 + i * 0.12)
    place(pluck(hz(['D5', 'E5', 'F#5', 'A5', 'D6', 'E6', 'F#6', 'A6', 'D7'][i]), 0.7, 1.2), 12.6 + i * 0.05 + 0.32, 0.045, pan=-0.6 + i * 0.15, verb=0.6)
n = int(0.7 * SR); t = tt(n)
sweep = np.sin(2 * np.pi * np.cumsum(expsweep(1200, 3600, n) * (1 + 0.004 * np.sin(2 * np.pi * 6 * t))) / SR)
place(fade(sweep * np.sin(np.linspace(0, np.pi, n)) ** 2, 0.01, 0.05), 13.3, 0.035, verb=0.7)
for k, (tm, nm) in enumerate([(13.45, 'A5'), (13.57, 'F#5'), (13.69, 'D6')]):
    place(bell(hz(nm), 1.2, 1.4), tm, 0.07, pan=(-0.4, 0.4, 0)[k], verb=0.7)
place(whoosh(0.4, 4000, 300, 0.92, 1.2, 0.8), 14.4, 0.28)
place(reverse_crash(0.36), 14.42, 0.16)
place(blip(1800, 0.08), 14.8, 0.1, verb=0.5)
place(tick(6000), 14.9, 0.18)

# ---------------------------------------------------------------- mix
def reverb_ir(dur=VERB_TAIL):
    n = int(dur * SR); t = tt(n)
    ir = []
    for ch in range(2):
        x = noise(n) * np.exp(-t / (dur * 0.28))
        x = fft_filter(x, 'lp', 6500, 1)
        x[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        ir.append(x / np.sqrt(np.sum(x ** 2)))
    return ir


def convolve(x, h):
    m = len(x) + len(h) - 1
    nfft = 1 << (m - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)[: len(x)]


ir = reverb_ir()
wet = np.vstack([convolve(fft_filter(send[0], 'hp', 250), ir[0]), convolve(fft_filter(send[1], 'hp', 250), ir[1])])
mix = dry + wet * 0.55
mix = np.vstack([fft_filter(mix[0], 'hp', 28, 2), fft_filter(mix[1], 'hp', 28, 2)])

# gentle glue: soft saturation into a peak-normalised master at -1 dBFS
peak = np.max(np.abs(mix))
mix = mix / peak * 1.25
mix = np.tanh(mix)
mix = mix / np.max(np.abs(mix)) * 10 ** (-1 / 20)
tail = int(0.03 * SR)
mix[:, -tail:] *= np.linspace(1, 0, tail)

for a, b, label in [(0, 1, 'keyframe'), (1, 4, 'ease..squash'), (4, 8, 'extrude/cloner'), (8, 11.5, 'parallax..loop'), (11.5, 12.5, 'blitz'), (12.5, 15, 'logo')]:
    seg = mix[:, int(a * SR):int(b * SR)]
    print(f'{label:16s} rms {20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9):6.1f} dBFS  peak {20 * np.log10(np.max(np.abs(seg)) + 1e-9):6.1f}')

out = sys.argv[1] if len(sys.argv) > 1 else 'soundtrack.wav'
pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote', out)
