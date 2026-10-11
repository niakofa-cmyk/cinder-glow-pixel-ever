"""Phase-1 LUFS prototype. Same K-weighting and gate as the console."""
import math


def k_coeffs(fs):
    db = 3.999843853973347
    f0 = 1681.974450955533
    q = 0.7071752369554196
    k = math.tan(math.pi * f0 / fs)
    vh = 10 ** (db / 20)
    vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    shelf = (
        (vh + vb * k / q + k * k) / a0,
        2 * (k * k - vh) / a0,
        (vh - vb * k / q + k * k) / a0,
        2 * (k * k - 1) / a0,
        (1 - k / q + k * k) / a0,
    )
    f0 = 38.13547087602444
    q = 0.5003270373238773
    k = math.tan(math.pi * f0 / fs)
    a0 = 1 + k / q + k * k
    hp = (1 / a0, -2 / a0, 1 / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0)
    return shelf, hp


def biquad(x, c):
    b0, b1, b2, a1, a2 = c
    s1 = s2 = 0.0
    y = [0.0] * len(x)
    for i, x0 in enumerate(x):
        y0 = b0 * x0 + s1
        s1 = b1 * x0 - a1 * y0 + s2
        s2 = b2 * x0 - a2 * y0
        y[i] = y0
    return y


def integrated_lufs(channels, fs):
    shelf, hp = k_coeffs(fs)
    weighted = []
    for ch in channels:
        w = biquad(biquad(ch, shelf), hp)
        prefix = [0.0]
        acc = 0.0
        for s in w:
            acc += s * s
            prefix.append(acc)
        weighted.append(prefix)
    block = round(0.4 * fs)
    hop = round(0.1 * fs)
    n = len(channels[0])
    blocks = []
    start = 0
    while start + block <= n:
        z = 0.0
        for p in weighted:
            z += (p[start + block] - p[start]) / block
        blocks.append(-0.691 + 10 * math.log10(z) if z > 1e-20 else -math.inf)
        start += hop
    abs_blocks = [v for v in blocks if v > -70]
    power = sum(10 ** ((v + 0.691) / 10) for v in abs_blocks) / len(abs_blocks)
    abs_loud = -0.691 + 10 * math.log10(power)
    rel = [v for v in abs_blocks if v > abs_loud - 10]
    power = sum(10 ** ((v + 0.691) / 10) for v in rel) / len(rel)
    return -0.691 + 10 * math.log10(power)


def main():
    fs = 48000
    seconds = 2
    n = fs * seconds
    amp = 10 ** (-23 / 20)
    tone = [amp * math.sin(2 * math.pi * 1000 * i / fs) for i in range(n)]
    loud = integrated_lufs([tone, tone], fs)
    if abs(loud + 23) > 0.15:
        raise SystemExit(f"expected -23 LUFS, got {loud}")
    print(f"python lufs ok {loud:.3f}")


if __name__ == "__main__":
    main()
