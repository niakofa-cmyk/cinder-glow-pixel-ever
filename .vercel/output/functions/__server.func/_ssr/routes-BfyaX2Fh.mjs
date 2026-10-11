import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as Download, i as Pause, r as Play, t as Upload } from "../_libs/lucide-react.mjs";
import { t as create } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BfyaX2Fh.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
/** RBJ Audio EQ Cookbook biquads. Coefficients are normalized so a0 = 1. */
function designBiquad(type, freq, q, gainDb, sampleRate) {
	const nyquist = sampleRate * .5;
	const f0 = Math.min(Math.max(10, freq), nyquist * .98);
	const Q = Math.max(.05, q);
	const A = Math.pow(10, gainDb / 40);
	const w0 = 2 * Math.PI * f0 / sampleRate;
	const cos = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 * Q);
	let b0 = 1;
	let b1 = 0;
	let b2 = 0;
	let a0 = 1;
	let a1 = 0;
	let a2 = 0;
	switch (type) {
		case "lowpass":
			b0 = (1 - cos) / 2;
			b1 = 1 - cos;
			b2 = (1 - cos) / 2;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case "highpass":
			b0 = (1 + cos) / 2;
			b1 = -(1 + cos);
			b2 = (1 + cos) / 2;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case "bandpass":
			b0 = alpha;
			b1 = 0;
			b2 = -alpha;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case "notch":
			b0 = 1;
			b1 = -2 * cos;
			b2 = 1;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case "peaking":
			b0 = 1 + alpha * A;
			b1 = -2 * cos;
			b2 = 1 - alpha * A;
			a0 = 1 + alpha / A;
			a1 = -2 * cos;
			a2 = 1 - alpha / A;
			break;
		case "lowshelf": {
			const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
			b0 = A * (A + 1 - (A - 1) * cos + twoSqrtAAlpha);
			b1 = 2 * A * (A - 1 - (A + 1) * cos);
			b2 = A * (A + 1 - (A - 1) * cos - twoSqrtAAlpha);
			a0 = A + 1 + (A - 1) * cos + twoSqrtAAlpha;
			a1 = -2 * (A - 1 + (A + 1) * cos);
			a2 = A + 1 + (A - 1) * cos - twoSqrtAAlpha;
			break;
		}
		case "highshelf": {
			const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
			b0 = A * (A + 1 + (A - 1) * cos + twoSqrtAAlpha);
			b1 = -2 * A * (A - 1 + (A + 1) * cos);
			b2 = A * (A + 1 + (A - 1) * cos - twoSqrtAAlpha);
			a0 = A + 1 - (A - 1) * cos + twoSqrtAAlpha;
			a1 = 2 * (A - 1 - (A + 1) * cos);
			a2 = A + 1 - (A - 1) * cos - twoSqrtAAlpha;
			break;
		}
		default: throw new Error(`Unknown filter ${type}`);
	}
	return {
		b0: b0 / a0,
		b1: b1 / a0,
		b2: b2 / a0,
		a1: a1 / a0,
		a2: a2 / a0
	};
}
/** Transposed direct form II, in place. Returns nothing; state is local (offline). */
function processBiquadInPlace(x, c) {
	let s1 = 0;
	let s2 = 0;
	const { b0, b1, b2, a1, a2 } = c;
	for (let i = 0; i < x.length; i++) {
		const x0 = x[i] ?? 0;
		const y0 = b0 * x0 + s1;
		s1 = b1 * x0 - a1 * y0 + s2;
		s2 = b2 * x0 - a2 * y0;
		x[i] = y0;
	}
}
function processBiquadChainInPlace(x, chain) {
	for (const c of chain) processBiquadInPlace(x, c);
}
/** Magnitude of H(e^jw) at `freq` Hz. */
function biquadMagnitudeDb(c, freq, sampleRate) {
	const w = 2 * Math.PI * freq / sampleRate;
	const cw = Math.cos(w);
	const sw = Math.sin(w);
	const c2 = Math.cos(2 * w);
	const s2 = Math.sin(2 * w);
	const br = c.b0 + c.b1 * cw + c.b2 * c2;
	const bi = -(c.b1 * sw + c.b2 * s2);
	const ar = 1 + c.a1 * cw + c.a2 * c2;
	const ai = -(c.a1 * sw + c.a2 * s2);
	const den = ar * ar + ai * ai;
	const hr = (br * ar + bi * ai) / den;
	const hi = (bi * ar - br * ai) / den;
	return 20 * Math.log10(Math.max(1e-12, Math.hypot(hr, hi)));
}
/**
* Forward-backward filtering. Zero phase. Magnitude is |H|^2, so callers that
* want a target curve must design H at half the desired decibel gain.
* Mirror-padded to keep the edges from ringing into the file.
*/
function filtfiltInPlace(x, chain) {
	if (chain.length === 0 || x.length < 8) return;
	const pad = Math.min(4096, Math.floor(x.length / 2) - 1);
	if (pad < 2) {
		processBiquadChainInPlace(x, chain);
		reverseInPlace(x);
		processBiquadChainInPlace(x, chain);
		reverseInPlace(x);
		return;
	}
	const ext = new Float64Array(x.length + pad * 2);
	const x0 = x[0] ?? 0;
	const xN = x[x.length - 1] ?? 0;
	for (let i = 0; i < pad; i++) {
		ext[pad - 1 - i] = 2 * x0 - (x[i + 1] ?? x0);
		ext[pad + x.length + i] = 2 * xN - (x[x.length - 2 - i] ?? xN);
	}
	ext.set(x, pad);
	processBiquadChainInPlace(ext, chain);
	reverseInPlace(ext);
	processBiquadChainInPlace(ext, chain);
	reverseInPlace(ext);
	x.set(ext.subarray(pad, pad + x.length));
}
function reverseInPlace(x) {
	let i = 0;
	let j = x.length - 1;
	while (i < j) {
		const a = x[i] ?? 0;
		x[i] = x[j] ?? 0;
		x[j] = a;
		i++;
		j--;
	}
}
function dbToGain(db) {
	return Math.pow(10, db / 20);
}
function gainToDb(gain) {
	return 20 * Math.log10(Math.max(1e-12, Math.abs(gain)));
}
function applyGainInPlace(x, gain) {
	if (gain === 1) return;
	for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) * gain;
}
/** Mid/side width. `width` 1 is unity, 0 is mono, >1 widens the side. */
function applyWidth(l, r, width) {
	const outL = new Float64Array(l.length);
	const outR = new Float64Array(r.length);
	const n = Math.min(l.length, r.length);
	const w = width;
	for (let i = 0; i < n; i++) {
		const mid = ((l[i] ?? 0) + (r[i] ?? 0)) * .5;
		const side = ((l[i] ?? 0) - (r[i] ?? 0)) * .5 * w;
		outL[i] = mid + side;
		outR[i] = mid - side;
	}
	return {
		l: outL,
		r: outR
	};
}
function encodeMidSide(l, r) {
	const n = Math.min(l.length, r.length);
	const mid = new Float64Array(n);
	const side = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		mid[i] = ((l[i] ?? 0) + (r[i] ?? 0)) * .5;
		side[i] = ((l[i] ?? 0) - (r[i] ?? 0)) * .5;
	}
	return {
		mid,
		side
	};
}
function decodeMidSide(mid, side) {
	const n = Math.min(mid.length, side.length);
	const l = new Float64Array(n);
	const r = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		l[i] = (mid[i] ?? 0) + (side[i] ?? 0);
		r[i] = (mid[i] ?? 0) - (side[i] ?? 0);
	}
	return {
		l,
		r
	};
}
/** (L+R)/2 on both channels. Equal-power mono fold of a centered source keeps its level. */
function foldMono(l, r) {
	const n = Math.min(l.length, r.length);
	const a = new Float64Array(n);
	const b = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const m = ((l[i] ?? 0) + (r[i] ?? 0)) * .5;
		a[i] = m;
		b[i] = m;
	}
	return {
		l: a,
		r: b
	};
}
/**
* Dynamic mid/side carve.
* When the center is loud inside `focusHz`, only the side component of that
* band is turned down. Wide guitars and cymbals move aside for a centered
* vocal. Centered instruments in the same band are not separated from the vocal —
* they live in mid, and mid is left alone. `depth` 0 is bit-transparent.
*/
function carveCenter(l, r, sampleRate, depth, focusHz) {
	const n = Math.min(l.length, r.length);
	const outL = new Float64Array(l.length);
	const outR = new Float64Array(r.length);
	if (n === 0 || depth <= 1e-6) {
		outL.set(l);
		outR.set(r);
		return {
			l: outL,
			r: outR
		};
	}
	const { mid, side } = encodeMidSide(l, r);
	const midBand = new Float64Array(mid);
	const sideBand = new Float64Array(side);
	const coeff = designBiquad("bandpass", Math.max(80, Math.min(sampleRate * .45, focusHz)), 1.15, 0, sampleRate);
	processBiquadInPlace(midBand, coeff);
	processBiquadInPlace(sideBand, coeff);
	const atk = Math.exp(-1 / Math.max(1, sampleRate * .004));
	const rel = Math.exp(-1 / Math.max(1, sampleRate * .085));
	const d = Math.max(0, Math.min(1, depth));
	let env = 0;
	for (let i = 0; i < n; i++) {
		const det = Math.abs(midBand[i] ?? 0);
		const c = det > env ? atk : rel;
		env = c * env + (1 - c) * det;
		const db = 20 * Math.log10(env + 1e-12);
		const g = 1 - d * Math.max(0, Math.min(1, (db + 40) / 22));
		const sideOut = (side[i] ?? 0) + (g - 1) * (sideBand[i] ?? 0);
		const m = mid[i] ?? 0;
		outL[i] = m + sideOut;
		outR[i] = m - sideOut;
	}
	if (l.length > n) outL.set(l.subarray(n), n);
	if (r.length > n) outR.set(r.subarray(n), n);
	return {
		l: outL,
		r: outR
	};
}
function neutralDynamics(partial = {}) {
	return {
		thresholdDb: -18,
		ratio: 1.5,
		attackMs: 20,
		releaseMs: 120,
		kneeDb: 6,
		makeupDb: 0,
		...partial
	};
}
function defaultBands() {
	return [
		{
			id: "hp",
			type: "highpass",
			freq: 28,
			gainDb: 0,
			q: .707,
			enabled: false
		},
		{
			id: "low",
			type: "lowshelf",
			freq: 120,
			gainDb: 0,
			q: .7,
			enabled: true
		},
		{
			id: "mud",
			type: "peaking",
			freq: 320,
			gainDb: 0,
			q: 1.1,
			enabled: true
		},
		{
			id: "presence",
			type: "peaking",
			freq: 3200,
			gainDb: 0,
			q: 1,
			enabled: true
		},
		{
			id: "air",
			type: "highshelf",
			freq: 1e4,
			gainDb: 0,
			q: .7,
			enabled: true
		}
	];
}
function neutralParams() {
	return {
		inputGainDb: 0,
		eqMode: "minimum",
		eqTarget: "stereo",
		bands: defaultBands(),
		dynamicEq: {
			enabled: false,
			freq: 3500,
			q: 1.4,
			thresholdDb: -24,
			ratio: 2,
			attackMs: 12,
			releaseMs: 90,
			maxCutDb: 3
		},
		deEss: {
			enabled: false,
			freq: 7200,
			q: 1.3,
			thresholdDb: -28,
			ratio: 3,
			attackMs: 1,
			releaseMs: 40,
			maxCutDb: 4
		},
		multiband: {
			enabled: false,
			lowHz: 140,
			highHz: 4500,
			low: neutralDynamics({
				thresholdDb: -20,
				ratio: 1.6,
				attackMs: 25,
				releaseMs: 140
			}),
			mid: neutralDynamics({
				thresholdDb: -18,
				ratio: 1.5,
				attackMs: 15,
				releaseMs: 100
			}),
			high: neutralDynamics({
				thresholdDb: -22,
				ratio: 1.4,
				attackMs: 8,
				releaseMs: 80
			})
		},
		glue: {
			enabled: false,
			optical: .55,
			...neutralDynamics({
				thresholdDb: -16,
				ratio: 1.4,
				attackMs: 30,
				releaseMs: 150,
				kneeDb: 8
			})
		},
		transient: {
			enabled: false,
			attack: 0,
			sustain: 0
		},
		saturation: {
			enabled: false,
			mode: "tape",
			driveDb: 4,
			mix: .35,
			memory: .4,
			lowColor: 0,
			highColor: 0,
			tubeTapeMix: .65
		},
		width: 1,
		carve: 0,
		carveHz: 2800,
		limiter: {
			enabled: true,
			ceilingDb: -1,
			releaseMs: 80,
			lookaheadMs: 5
		}
	};
}
function presets() {
	const neutral = neutralParams();
	const streaming = neutralParams();
	streaming.bands = defaultBands().map((b) => b.id === "hp" ? {
		...b,
		enabled: true,
		freq: 26
	} : b);
	streaming.glue = {
		...streaming.glue,
		enabled: true,
		thresholdDb: -14,
		ratio: 1.3,
		makeupDb: 0
	};
	streaming.limiter = {
		...streaming.limiter,
		enabled: true,
		ceilingDb: -1
	};
	const warmth = neutralParams();
	warmth.bands = defaultBands().map((b) => {
		if (b.id === "low") return {
			...b,
			gainDb: 1.2
		};
		if (b.id === "air") return {
			...b,
			gainDb: -.6
		};
		if (b.id === "mud") return {
			...b,
			gainDb: -.8,
			freq: 280
		};
		return b;
	});
	warmth.saturation = {
		enabled: true,
		mode: "hybrid",
		driveDb: 6,
		mix: .34,
		memory: .55,
		lowColor: .2,
		highColor: -.05,
		tubeTapeMix: .72
	};
	warmth.glue = {
		...warmth.glue,
		enabled: true,
		thresholdDb: -16,
		ratio: 1.5,
		makeupDb: .5,
		optical: .6
	};
	const vocal = neutralParams();
	vocal.bands = defaultBands().map((b) => {
		if (b.id === "presence") return {
			...b,
			gainDb: 1.4,
			freq: 3400,
			q: 1.1
		};
		if (b.id === "mud") return {
			...b,
			gainDb: -1.2,
			freq: 300,
			q: 1
		};
		return b;
	});
	vocal.deEss = {
		...vocal.deEss,
		enabled: true,
		thresholdDb: -30,
		maxCutDb: 3
	};
	vocal.dynamicEq = {
		...vocal.dynamicEq,
		enabled: true,
		freq: 3800,
		maxCutDb: 2.5,
		thresholdDb: -26
	};
	vocal.carve = .4;
	vocal.carveHz = 3200;
	const punch = neutralParams();
	punch.transient = {
		enabled: true,
		attack: .35,
		sustain: -.15
	};
	punch.multiband = {
		...punch.multiband,
		enabled: true,
		low: {
			...punch.multiband.low,
			thresholdDb: -22,
			ratio: 2,
			attackMs: 30
		}
	};
	return [
		{
			id: "neutral",
			name: "Neutral",
			detail: "Safety limiter only. Nothing is colored.",
			params: neutral
		},
		{
			id: "streaming",
			name: "Streaming start",
			detail: "High-pass and a light glue stage. You still set the loudness.",
			params: streaming
		},
		{
			id: "warmth",
			name: "Gentle warmth",
			detail: "Small low shelf, a hybrid tape curve with a little hysteresis, less air. Not a hardware clone.",
			params: warmth
		},
		{
			id: "vocal",
			name: "Vocal clarity",
			detail: "Modest presence, a mud cut, de-ess, a dynamic 3.8 kHz restraint, and a side carve around the vocal.",
			params: vocal
		},
		{
			id: "punch",
			name: "Transient punch",
			detail: "More attack, slightly less sustain, light low-band control.",
			params: punch
		}
	];
}
/**
* TPDF dither then quantize to `bits`. Error is uncorrelated triangular noise
* of width 1 LSB, which linearizes quiet signals instead of freezing them into
* a staircase. 32-bit float export does not call this.
*/
function quantizeWithDither(x, bits, random = Math.random) {
	const steps = bits === 16 ? 32768 : 8388608;
	const lsb = 1 / steps;
	const y = new Float64Array(x.length);
	const maxCode = steps - 1;
	for (let i = 0; i < x.length; i++) {
		const tpdf = (random() + random() - 1) * lsb;
		const dithered = (x[i] ?? 0) + tpdf;
		let code = Math.round(dithered * steps);
		if (code > maxCode) code = maxCode;
		if (code < -steps) code = -steps;
		y[i] = code / steps;
	}
	return y;
}
function readStr(view, offset, length) {
	let s = "";
	for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
	return s;
}
/**
* PCM and float WAV, including files with JUNK/LIST chunks and extensible fmt.
* Returns null when the file is not a WAV this parser understands, so the
* caller can fall back to the browser decoder for MP3, FLAC, and the rest.
* Sample rate is the rate in the file — nothing is resampled.
*/
function decodeWavPcm(bytes) {
	if (bytes.byteLength < 44) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = readStr(view, 0, 4);
	if (tag !== "RIFF" && tag !== "RF64" || readStr(view, 8, 4) !== "WAVE") return null;
	let audioFormat = 0;
	let channels = 0;
	let sampleRate = 0;
	let bitDepth = 0;
	let blockAlign = 0;
	let dataOffset = -1;
	let dataBytes = 0;
	let dataSize64 = 0;
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const id = readStr(view, offset, 4);
		const size = view.getUint32(offset + 4, true);
		const start = offset + 8;
		if (start > bytes.byteLength) break;
		if (id === "fmt " && size >= 16) {
			audioFormat = view.getUint16(start, true);
			channels = view.getUint16(start + 2, true);
			sampleRate = view.getUint32(start + 4, true);
			blockAlign = view.getUint16(start + 12, true);
			bitDepth = view.getUint16(start + 14, true);
			if (audioFormat === 65534 && size >= 40 && start + 26 <= bytes.byteLength) audioFormat = view.getUint16(start + 24, true);
		} else if (id === "ds64" && size >= 16 && start + 16 <= bytes.byteLength) dataSize64 = Number(view.getBigUint64(start + 8, true));
		else if (id === "data") {
			dataOffset = start;
			dataBytes = Math.min(size === 4294967295 && dataSize64 > 0 ? dataSize64 : size, bytes.byteLength - start);
			break;
		}
		const step = size + size % 2;
		offset = start + step;
		if (step < 0) break;
	}
	if (dataOffset < 0 || channels < 1 || channels > 8 || sampleRate < 1e3 || sampleRate > 384e3) return null;
	const bytesPerSample = bitDepth === 24 ? 3 : bitDepth / 8;
	if (![1, 3].includes(audioFormat) || ![
		8,
		16,
		24,
		32
	].includes(bitDepth)) return null;
	if (audioFormat === 3 && bitDepth !== 32) return null;
	const stride = blockAlign > 0 ? blockAlign : channels * bytesPerSample;
	if (stride < channels * bytesPerSample) return null;
	const frames = Math.floor(dataBytes / stride);
	if (frames < 1) return null;
	const l = new Float64Array(frames);
	const r = new Float64Array(frames);
	const sample = (pos) => {
		if (pos + bytesPerSample > bytes.byteLength) return null;
		if (audioFormat === 3) return view.getFloat32(pos, true);
		if (bitDepth === 16) return view.getInt16(pos, true) / 32768;
		if (bitDepth === 8) return (view.getUint8(pos) - 128) / 128;
		if (bitDepth === 32) return view.getInt32(pos, true) / 2147483648;
		const b0 = view.getUint8(pos);
		const b1 = view.getUint8(pos + 1);
		const b2 = view.getUint8(pos + 2);
		let v = b0 | b1 << 8 | b2 << 16;
		if (v & 8388608) v -= 16777216;
		return v / 8388608;
	};
	for (let i = 0; i < frames; i++) {
		const base = dataOffset + i * stride;
		const left = sample(base);
		const right = channels > 1 ? sample(base + bytesPerSample) : left;
		if (left === null || right === null) return null;
		l[i] = left;
		r[i] = right;
	}
	return {
		l,
		r,
		sampleRate
	};
}
function writeStr(view, offset, s) {
	for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
/**
* PCM 16, PCM 24, or IEEE float 32. Little-endian RIFF.
* Integer paths assume the caller already dithered, and recover the integer
* code from multiples of 1/2^(bits-1). Float 32 is written without clipping.
*/
function encodeWav(channels, sampleRate, bitDepth) {
	const chs = channels.length;
	const frames = channels[0]?.length ?? 0;
	const blockAlign = chs * (bitDepth === 32 ? 4 : bitDepth === 24 ? 3 : 2);
	const dataBytes = frames * blockAlign;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);
	writeStr(view, 0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	writeStr(view, 8, "WAVE");
	writeStr(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
	view.setUint16(22, chs, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitDepth, true);
	writeStr(view, 36, "data");
	view.setUint32(40, dataBytes, true);
	let offset = 44;
	const fullScale = bitDepth === 16 ? 32768 : 8388608;
	const maxCode = fullScale - 1;
	for (let i = 0; i < frames; i++) for (let c = 0; c < chs; c++) {
		const sample = channels[c]?.[i] ?? 0;
		if (bitDepth === 32) {
			view.setFloat32(offset, sample, true);
			offset += 4;
		} else if (bitDepth === 16) {
			let code = Math.round(sample * fullScale);
			if (code > maxCode) code = maxCode;
			if (code < -fullScale) code = -fullScale;
			view.setInt16(offset, code, true);
			offset += 2;
		} else {
			let code = Math.round(sample * fullScale);
			if (code > maxCode) code = maxCode;
			if (code < -fullScale) code = -fullScale;
			view.setUint8(offset, code & 255);
			view.setUint8(offset + 1, code >> 8 & 255);
			view.setUint8(offset + 2, code >> 16 & 255);
			offset += 3;
		}
	}
	return new Uint8Array(buffer);
}
/** In-place radix-2 Cooley–Tukey. `re` and `im` length must be a power of two. */
function fft(re, im, inverse = false) {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			const tr = re[i] ?? 0;
			const ti = im[i] ?? 0;
			re[i] = re[j] ?? 0;
			im[i] = im[j] ?? 0;
			re[j] = tr;
			im[j] = ti;
		}
	}
	const sign = inverse ? 1 : -1;
	for (let len = 2; len <= n; len <<= 1) {
		const ang = sign * 2 * Math.PI / len;
		const wlenRe = Math.cos(ang);
		const wlenIm = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let wRe = 1;
			let wIm = 0;
			const half = len >> 1;
			for (let j = 0; j < half; j++) {
				const uRe = re[i + j] ?? 0;
				const uIm = im[i + j] ?? 0;
				const vRe = re[i + j + half] ?? 0;
				const vIm = im[i + j + half] ?? 0;
				const tRe = vRe * wRe - vIm * wIm;
				const tIm = vRe * wIm + vIm * wRe;
				re[i + j] = uRe + tRe;
				im[i + j] = uIm + tIm;
				re[i + j + half] = uRe - tRe;
				im[i + j + half] = uIm - tIm;
				const nextRe = wRe * wlenRe - wIm * wlenIm;
				wIm = wRe * wlenIm + wIm * wlenRe;
				wRe = nextRe;
			}
		}
	}
	if (inverse) for (let i = 0; i < n; i++) {
		re[i] = (re[i] ?? 0) / n;
		im[i] = (im[i] ?? 0) / n;
	}
}
function nextPow2(n) {
	let p = 1;
	while (p < n) p <<= 1;
	return p;
}
/** One-sided amplitude spectrum in dBFS, Hann window, coherent-gain corrected. */
function amplitudeSpectrumDb(x, sampleRate, fftSize) {
	const n = fftSize;
	const re = new Float64Array(n);
	const im = new Float64Array(n);
	const use = Math.min(n, x.length);
	let winSum = 0;
	for (let i = 0; i < use; i++) {
		const w = .5 * (1 - Math.cos(2 * Math.PI * i / Math.max(1, use - 1)));
		winSum += w;
		re[i] = (x[i] ?? 0) * w;
	}
	fft(re, im, false);
	const bins = n / 2;
	const db = new Float64Array(bins);
	const norm = Math.max(1e-20, winSum);
	for (let k = 0; k < bins; k++) {
		const mag = Math.hypot(re[k] ?? 0, im[k] ?? 0);
		const amp = (k === 0 ? 1 : 2) * (mag / norm);
		db[k] = 20 * Math.log10(Math.max(1e-12, amp));
	}
	return {
		db,
		binHz: sampleRate / n
	};
}
/**
* Welch-averaged amplitude spectrum. Returns dBFS per bin.
* `binHz` is sampleRate / fftSize.
*/
function welchSpectrumDb(x, sampleRate, fftSize = 8192, hop = 4096) {
	if (x.length < 32) return amplitudeSpectrumDb(x, sampleRate, nextPow2(Math.max(32, x.length)));
	const size = nextPow2(fftSize);
	const bins = size / 2;
	const acc = new Float64Array(bins);
	let frames = 0;
	const re = new Float64Array(size);
	const im = new Float64Array(size);
	const window = new Float64Array(size);
	let winSum = 0;
	for (let i = 0; i < size; i++) {
		const w = .5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
		window[i] = w;
		winSum += w;
	}
	const step = Math.max(1, hop);
	for (let start = 0; start + size <= x.length; start += step) {
		re.fill(0);
		im.fill(0);
		for (let i = 0; i < size; i++) re[i] = (x[start + i] ?? 0) * (window[i] ?? 0);
		fft(re, im, false);
		for (let k = 0; k < bins; k++) {
			const mag = Math.hypot(re[k] ?? 0, im[k] ?? 0);
			const amp = (k === 0 ? 1 : 2) * (mag / winSum);
			acc[k] = (acc[k] ?? 0) + amp * amp;
		}
		frames++;
		if (frames > 80) break;
	}
	if (frames === 0) return amplitudeSpectrumDb(x, sampleRate, size);
	const db = new Float64Array(bins);
	for (let k = 0; k < bins; k++) {
		const meanPower = (acc[k] ?? 0) / frames;
		db[k] = 20 * Math.log10(Math.max(1e-12, Math.sqrt(meanPower)));
	}
	return {
		db,
		binHz: sampleRate / size
	};
}
/** ISO preferred 1/3-octave centers from ~20 Hz to ~20 kHz. */
function thirdOctaveCenters() {
	const centers = [];
	for (let k = -16; k <= 14; k++) {
		const f = 1e3 * Math.pow(2, k / 3);
		if (f >= 20 && f <= 2e4) centers.push(f);
	}
	return centers;
}
function thirdOctaveFromSpectrum(db, binHz, sampleRate) {
	const nyquist = sampleRate * .5;
	return thirdOctaveCenters().filter((f) => f * Math.pow(2, -1 / 6) < nyquist).map((freq) => {
		const lo = freq * Math.pow(2, -1 / 6);
		const hi = freq * Math.pow(2, 1 / 6);
		const i0 = Math.max(1, Math.floor(lo / binHz));
		const i1 = Math.min(db.length - 1, Math.ceil(hi / binHz));
		let power = 0;
		let count = 0;
		for (let i = i0; i <= i1; i++) {
			const d = db[i] ?? -120;
			power += Math.pow(10, d / 10);
			count++;
		}
		const mean = count > 0 ? power / count : 1e-12;
		return {
			freq,
			db: 10 * Math.log10(Math.max(1e-12, mean))
		};
	});
}
/**
* K-weighting (ITU-R BS.1770): a high shelf (~+4 dB, 1.7 kHz) followed by an
* RLB high-pass (~38 Hz). Coefficient design matches libebur128, which is
* built to hit the EBU Tech 3341 1 kHz / -23 LUFS alignment tone.
*/
function kWeightingCoeffs(sampleRate) {
	const db = 3.999843853973347;
	let f0 = 1681.974450955533;
	let Q = .7071752369554196;
	let K = Math.tan(Math.PI * f0 / sampleRate);
	const Vh = Math.pow(10, db / 20);
	const Vb = Math.pow(Vh, .4996667741545416);
	let a0 = 1 + K / Q + K * K;
	const shelf = {
		b0: (Vh + Vb * K / Q + K * K) / a0,
		b1: 2 * (K * K - Vh) / a0,
		b2: (Vh - Vb * K / Q + K * K) / a0,
		a1: 2 * (K * K - 1) / a0,
		a2: (1 - K / Q + K * K) / a0
	};
	f0 = 38.13547087602444;
	Q = .5003270373238773;
	K = Math.tan(Math.PI * f0 / sampleRate);
	a0 = 1 + K / Q + K * K;
	return {
		shelf,
		highpass: {
			b0: 1 / a0,
			b1: -2 / a0,
			b2: 1 / a0,
			a1: 2 * (K * K - 1) / a0,
			a2: (1 - K / Q + K * K) / a0
		}
	};
}
function applyKWeightingInPlace(x, sampleRate) {
	const { shelf, highpass } = kWeightingCoeffs(sampleRate);
	processBiquadInPlace(x, shelf);
	processBiquadInPlace(x, highpass);
}
var ABSOLUTE_GATE = -70;
var RELATIVE_GATE_OFFSET = 10;
function meanSquare(prefix, a, b) {
	const len = b - a;
	if (len <= 0) return 0;
	return ((prefix[b] ?? 0) - (prefix[a] ?? 0)) / len;
}
function prefixSquares(x) {
	const p = new Float64Array(x.length + 1);
	let acc = 0;
	for (let i = 0; i < x.length; i++) {
		const s = x[i] ?? 0;
		acc += s * s;
		p[i + 1] = acc;
	}
	return p;
}
function blockLoudness(z) {
	if (z <= 1e-20) return -Infinity;
	return -.691 + 10 * Math.log10(z);
}
function percentile(sorted, p) {
	if (sorted.length === 0) return -Infinity;
	const idx = (sorted.length - 1) * p;
	const lo = Math.floor(idx);
	const hi = Math.min(sorted.length - 1, lo + 1);
	const t = idx - lo;
	return (sorted[lo] ?? 0) * (1 - t) + (sorted[hi] ?? 0) * t;
}
/**
* Integrated, short-term, momentary loudness and a Tech 3342-style loudness range.
* Stereo weights are 1.0 / 1.0. Mono is a single channel.
* A 1 kHz stereo sine at −23 dBFS reads −23.0 LUFS (EBU Tech 3341).
*/
function measureLoudness(channels, sampleRate) {
	const weighted = channels.map((ch) => {
		const y = new Float64Array(ch);
		applyKWeightingInPlace(y, sampleRate);
		return prefixSquares(y);
	});
	const n = channels[0]?.length ?? 0;
	const block = Math.round(.4 * sampleRate);
	const hop = Math.round(.1 * sampleRate);
	const stBlock = Math.round(3 * sampleRate);
	const momentary = [];
	for (let start = 0; start + block <= n; start += hop) {
		let z = 0;
		for (const p of weighted) z += meanSquare(p, start, start + block);
		momentary.push(blockLoudness(z));
	}
	const shortTerm = [];
	const stHop = hop;
	for (let start = 0; start + stBlock <= n; start += stHop) {
		let z = 0;
		for (const p of weighted) z += meanSquare(p, start, start + stBlock);
		shortTerm.push(blockLoudness(z));
	}
	const integrated = gatedIntegrated(momentary);
	const momentaryMax = momentary.length ? Math.max(...momentary.filter((v) => Number.isFinite(v))) : -Infinity;
	const shortTermMax = shortTerm.length ? Math.max(...shortTerm.filter((v) => Number.isFinite(v))) : momentaryMax;
	const range = loudnessRange(shortTerm.length >= 2 ? shortTerm : momentary);
	return {
		integrated,
		shortTermMax: Number.isFinite(shortTermMax) ? shortTermMax : -Infinity,
		momentaryMax: Number.isFinite(momentaryMax) ? momentaryMax : -Infinity,
		range
	};
}
function gatedIntegrated(blocks) {
	const finite = blocks.filter((v) => Number.isFinite(v));
	if (finite.length === 0) return -Infinity;
	const abs = finite.filter((v) => v > ABSOLUTE_GATE);
	if (abs.length === 0) return -Infinity;
	const absLoud = blockLoudness(abs.reduce((s, v) => s + Math.pow(10, (v + .691) / 10), 0) / abs.length);
	const relThreshold = absLoud - RELATIVE_GATE_OFFSET;
	const rel = abs.filter((v) => v > relThreshold);
	if (rel.length === 0) return absLoud;
	return blockLoudness(rel.reduce((s, v) => s + Math.pow(10, (v + .691) / 10), 0) / rel.length);
}
/** EBU Tech 3342: LRA = 95th − 10th percentile of gated short-term loudness. */
function loudnessRange(shortTerm) {
	const finite = shortTerm.filter((v) => Number.isFinite(v) && v > ABSOLUTE_GATE);
	if (finite.length < 2) return 0;
	const gate = blockLoudness(finite.reduce((s, v) => s + Math.pow(10, (v + .691) / 10), 0) / finite.length) - 20;
	const gated = finite.filter((v) => v >= gate).sort((a, b) => a - b);
	if (gated.length < 2) return 0;
	return Math.max(0, percentile(gated, .95) - percentile(gated, .1));
}
/** Pearson correlation of the AC component of L and R. +1 identical, −1 inverted. */
function stereoCorrelation(l, r) {
	const n = Math.min(l.length, r.length);
	if (n === 0) return 1;
	let sumL = 0;
	let sumR = 0;
	for (let i = 0; i < n; i++) {
		sumL += l[i] ?? 0;
		sumR += r[i] ?? 0;
	}
	const meanL = sumL / n;
	const meanR = sumR / n;
	let num = 0;
	let denL = 0;
	let denR = 0;
	for (let i = 0; i < n; i++) {
		const a = (l[i] ?? 0) - meanL;
		const b = (r[i] ?? 0) - meanR;
		num += a * b;
		denL += a * a;
		denR += b * b;
	}
	const den = Math.sqrt(denL * denR);
	if (den < 1e-18) return 1;
	return Math.max(-1, Math.min(1, num / den));
}
function rms(x) {
	let s = 0;
	for (let i = 0; i < x.length; i++) {
		const v = x[i] ?? 0;
		s += v * v;
	}
	return Math.sqrt(s / Math.max(1, x.length));
}
function mean(x) {
	let s = 0;
	for (let i = 0; i < x.length; i++) s += x[i] ?? 0;
	return s / Math.max(1, x.length);
}
function peakAbs(x) {
	let p = 0;
	for (let i = 0; i < x.length; i++) {
		const a = Math.abs(x[i] ?? 0);
		if (a > p) p = a;
	}
	return p;
}
function countClipped(x, threshold = .999) {
	let c = 0;
	for (let i = 0; i < x.length; i++) if (Math.abs(x[i] ?? 0) >= threshold) c++;
	return c;
}
/** Fraction of spectral power between loHz and hiHz. */
function bandEnergyRatio(db, binHz, loHz, hiHz) {
	let band = 0;
	let total = 0;
	for (let i = 1; i < db.length; i++) {
		const f = i * binHz;
		const p = Math.pow(10, (db[i] ?? -120) / 10);
		total += p;
		if (f >= loHz && f < hiHz) band += p;
	}
	if (total <= 0) return 0;
	return band / total;
}
function sideEnergyRatio(l, r) {
	let midE = 0;
	let sideE = 0;
	const n = Math.min(l.length, r.length);
	for (let i = 0; i < n; i++) {
		const m = ((l[i] ?? 0) + (r[i] ?? 0)) * .5;
		const s = ((l[i] ?? 0) - (r[i] ?? 0)) * .5;
		midE += m * m;
		sideE += s * s;
	}
	const total = midE + sideE;
	if (total <= 1e-20) return 0;
	return sideE / total;
}
/**
* 4× windowed-sinc interpolation. Phase 0 is an integer delay (identity),
* so sample-peak and true-peak agree on signals that already peak on a sample.
* Radius 16 → 32 taps. Accurate enough for inter-sample peaks within ~0.2 dB.
*/
var RADIUS = 16;
var PHASES = 4;
function sincWindow(x) {
	if (Math.abs(x) < 1e-9) return 1;
	if (Math.abs(x) >= RADIUS) return 0;
	return Math.sin(Math.PI * x) / (Math.PI * x) * (.42 - .5 * Math.cos(Math.PI * (x + RADIUS) / RADIUS) + .08 * Math.cos(2 * Math.PI * (x + RADIUS) / RADIUS));
}
var kernels = null;
function interpKernels() {
	if (kernels) return kernels;
	kernels = [];
	for (let p = 0; p < PHASES; p++) {
		const d = p / PHASES;
		const k = /* @__PURE__ */ new Float64Array(32);
		for (let i = 0; i < 32; i++) {
			const tap = i - RADIUS;
			k[i] = sincWindow(tap - d);
		}
		let sum = 0;
		for (let i = 0; i < k.length; i++) sum += k[i] ?? 0;
		if (Math.abs(sum) > 1e-9) for (let i = 0; i < k.length; i++) k[i] = (k[i] ?? 0) / sum;
		kernels.push(k);
	}
	return kernels;
}
function interpAt(x, index, phase) {
	const k = interpKernels()[phase];
	if (!k) return 0;
	let acc = 0;
	const base = index - RADIUS;
	for (let i = 0; i < k.length; i++) {
		base + i + 1;
		const sampleIndex = index + (i - RADIUS);
		if (sampleIndex >= 0 && sampleIndex < x.length) acc += (x[sampleIndex] ?? 0) * (k[i] ?? 0);
	}
	return acc;
}
/**
* True peak via 4× oversampling. Interpolation runs only on the shoulder of
* local peaks. A band-limited inter-sample peak cannot hide more than about
* 3 dB above its neighboring samples, and it cannot win from a quiet valley.
*/
function measureTruePeak(channels) {
	let samplePeak = 0;
	for (const ch of channels) for (let i = 0; i < ch.length; i++) {
		const a = Math.abs(ch[i] ?? 0);
		if (a > samplePeak) samplePeak = a;
	}
	let truePeak = samplePeak;
	const floor = samplePeak * Math.pow(10, -3.2 / 20);
	for (const ch of channels) {
		const n = ch.length;
		for (let i = 0; i < n - 1; i++) {
			const a = Math.abs(ch[i] ?? 0);
			const b = Math.abs(ch[i + 1] ?? 0);
			const m = a > b ? a : b;
			if (m < floor || m * 1.445 < truePeak) continue;
			if (a >= b) {
				if (a < (i > 0 ? Math.abs(ch[i - 1] ?? 0) : -1)) continue;
			} else if (b < (i + 2 < n ? Math.abs(ch[i + 2] ?? 0) : -1)) continue;
			for (let p = 1; p < PHASES; p++) {
				const y = Math.abs(interpAt(ch, i, p));
				if (y > truePeak) truePeak = y;
			}
		}
	}
	return {
		samplePeak,
		truePeak,
		samplePeakDb: gainToDb(samplePeak),
		truePeakDb: gainToDb(truePeak)
	};
}
/** Local 4× peak between sample i and i+1, used by the true-peak limiter. */
function localTruePeak(x, i) {
	let peak = Math.abs(x[i] ?? 0);
	const next = Math.abs(x[i + 1] ?? 0);
	if (next > peak) peak = next;
	if (i + 1 >= x.length) return peak;
	for (let p = 1; p < PHASES; p++) {
		const y = Math.abs(interpAt(x, i, p));
		if (y > peak) peak = y;
	}
	return peak;
}
/**
* Peak between sample i and i+1 for every i, written into `peaks`.
* Samples more than ~3.2 dB under `guard` are stored as 0 — their
* inter-sample peak cannot cross a ceiling that sits at `guard`.
* The interior uses one tight pass over the three fractional phases.
*/
function writeIntervalPeaks(x, peaks, guard) {
	const n = Math.min(x.length, peaks.length);
	const ks = interpKernels();
	const k1 = ks[1];
	const k2 = ks[2];
	const k3 = ks[3];
	const last = n - 1;
	for (let i = 0; i < last; i++) {
		const a = x[i] ?? 0;
		const b = x[i + 1] ?? 0;
		const aa = a < 0 ? -a : a;
		const bb = b < 0 ? -b : b;
		if (aa < guard && bb < guard) {
			peaks[i] = 0;
			continue;
		}
		if (!k1 || !k2 || !k3 || i < RADIUS || i + RADIUS >= n) {
			peaks[i] = localTruePeak(x, i);
			continue;
		}
		let peak = aa > bb ? aa : bb;
		const base = i - RADIUS;
		let y1 = 0;
		let y2 = 0;
		let y3 = 0;
		for (let t = 0; t < k1.length; t++) {
			const s = x[base + t] ?? 0;
			y1 += s * (k1[t] ?? 0);
			y2 += s * (k2[t] ?? 0);
			y3 += s * (k3[t] ?? 0);
		}
		const p1 = y1 < 0 ? -y1 : y1;
		const p2 = y2 < 0 ? -y2 : y2;
		const p3 = y3 < 0 ? -y3 : y3;
		if (p1 > peak) peak = p1;
		if (p2 > peak) peak = p2;
		if (p3 > peak) peak = p3;
		peaks[i] = peak;
	}
	if (n > 0) peaks[last] = Math.abs(x[last] ?? 0);
}
function bandDb(thirds, lo, hi) {
	const slice = thirds.filter((t) => t.freq >= lo && t.freq <= hi);
	if (slice.length === 0) return -120;
	const power = slice.reduce((s, t) => s + Math.pow(10, t.db / 10), 0) / slice.length;
	return 10 * Math.log10(Math.max(1e-12, power));
}
function findResonances(thirds) {
	const found = [];
	for (let i = 2; i < thirds.length - 2; i++) {
		const level = thirds[i]?.db ?? -120;
		const neighbors = [
			thirds[i - 2]?.db ?? level,
			thirds[i - 1]?.db ?? level,
			thirds[i + 1]?.db ?? level,
			thirds[i + 2]?.db ?? level
		];
		const excess = level - neighbors.reduce((s, v) => s + v, 0) / neighbors.length;
		if (excess >= 4.5 && level > -48) found.push({
			freq: thirds[i]?.freq ?? 0,
			excessDb: excess,
			levelDb: level
		});
	}
	return found.sort((a, b) => b.excessDb - a.excessDb).slice(0, 6);
}
/** Full Phase-1 measurement. Mono files should pass the same buffer as L and R. */
function analyze(l, r, sampleRate) {
	const loud = measureLoudness([l, r], sampleRate);
	const peaks = measureTruePeak([l, r]);
	const spec = welchSpectrumDb(l, sampleRate, 8192, 4096);
	const thirds = thirdOctaveFromSpectrum(spec.db, spec.binHz, sampleRate);
	const rmsVal = Math.sqrt(.5 * (rms(l) ** 2 + rms(r) ** 2));
	const peak = Math.max(peakAbs(l), peakAbs(r));
	return {
		sampleRate,
		durationSec: l.length / sampleRate,
		channels: 2,
		integratedLufs: loud.integrated,
		shortTermMaxLufs: loud.shortTermMax,
		momentaryMaxLufs: loud.momentaryMax,
		loudnessRange: loud.range,
		samplePeakDb: peaks.samplePeakDb,
		truePeakDb: peaks.truePeakDb,
		crestDb: gainToDb(peak / Math.max(1e-12, rmsVal)),
		rmsDb: gainToDb(rmsVal),
		correlation: stereoCorrelation(l, r),
		dcL: mean(l),
		dcR: mean(r),
		clippedSamples: countClipped(l) + countClipped(r),
		sideEnergyRatio: sideEnergyRatio(l, r),
		subEnergyRatio: bandEnergyRatio(spec.db, spec.binHz, 20, 80),
		presenceDb: bandDb(thirds, 2e3, 5e3),
		sibilanceDb: bandDb(thirds, 5e3, 1e4),
		thirds,
		resonances: findResonances(thirds),
		spectrumDb: spec.db,
		spectrumFreq0: spec.binHz,
		spectrumBinHz: spec.binHz
	};
}
/** Shape comparison. Each curve is centered on its own mean so level doesn't masquerade as tone. */
function spectralDelta(program, reference) {
	const n = Math.min(program.length, reference.length);
	const p = program.slice(0, n);
	const r = reference.slice(0, n);
	const meanP = p.reduce((s, b) => s + b.db, 0) / Math.max(1, n);
	const meanR = r.reduce((s, b) => s + b.db, 0) / Math.max(1, n);
	return p.map((band, i) => {
		const ref = r[i];
		const pDb = band.db - meanP;
		const rDb = (ref?.db ?? band.db) - meanR;
		return {
			freq: band.freq,
			deltaDb: pDb - rDb,
			programDb: pDb,
			referenceDb: rDb
		};
	});
}
/**
* Linkwitz–Riley 4th-order magnitude is |H|² of one Butterworth 2nd-order
* section (Q = 1/√2). Running that section forward and back makes the phase
* zero, so band sums do not smear or cancel at the crossover. Short buffers
* fall back to two cascaded minimum-phase sections — filtfilt needs room to pad.
*/
function butterworth2(kind, freq, sampleRate) {
	return designBiquad(kind, freq, Math.SQRT1_2, 0, sampleRate);
}
function minimumPhaseLr4(x, section) {
	processBiquadInPlace(x, section);
	processBiquadInPlace(x, section);
}
function linkwitzRiley4InPlace(x, kind, freq, sampleRate) {
	const section = butterworth2(kind, freq, sampleRate);
	if (x.length < 32) {
		minimumPhaseLr4(x, section);
		return;
	}
	filtfiltInPlace(x, [section]);
}
function splitLinkwitzRiley4(x, freq, sampleRate) {
	const low = new Float64Array(x);
	const high = new Float64Array(x);
	linkwitzRiley4InPlace(low, "lowpass", freq, sampleRate);
	linkwitzRiley4InPlace(high, "highpass", freq, sampleRate);
	return {
		low,
		high
	};
}
/**
* Three-band split. Because every band is zero-phase, the low band does not
* need the upper crossover's allpass — low + mid + high reconstructs flat.
*/
function splitThreeBand(x, lowHz, highHz, sampleRate) {
	const first = splitLinkwitzRiley4(x, lowHz, sampleRate);
	const second = splitLinkwitzRiley4(first.high, highHz, sampleRate);
	return {
		low: first.low,
		mid: second.low,
		high: second.high
	};
}
/** Gain-computer. Returns positive dB of attenuation. Soft knee is continuous. */
function gainReductionDb(levelDb, thresholdDb, ratio, kneeDb) {
	const slope = 1 - 1 / Math.max(1, ratio);
	if (slope <= 0) return 0;
	if (kneeDb <= 0) {
		if (levelDb <= thresholdDb) return 0;
		return slope * (levelDb - thresholdDb);
	}
	const lower = thresholdDb - kneeDb / 2;
	const upper = thresholdDb + kneeDb / 2;
	if (levelDb < lower) return 0;
	if (levelDb > upper) return slope * (levelDb - thresholdDb);
	const x = levelDb - lower;
	return slope * (x * x) / (2 * kneeDb);
}
/**
* Stereo-linked feedforward compressor. Detector is the peak of |L| and |R|
* with independent attack and release one-poles. Makeup is static gain.
*/
function compressStereo(l, r, sampleRate, params) {
	const outL = new Float64Array(l.length);
	const outR = new Float64Array(r.length);
	const atk = Math.exp(-1 / Math.max(1, params.attackMs / 1e3 * sampleRate));
	const rel = Math.exp(-1 / Math.max(1, params.releaseMs / 1e3 * sampleRate));
	const makeup = dbToGain(params.makeupDb);
	let env = 0;
	let grSum = 0;
	const n = Math.min(l.length, r.length);
	for (let i = 0; i < n; i++) {
		const det = Math.max(Math.abs(l[i] ?? 0), Math.abs(r[i] ?? 0));
		const c = det > env ? atk : rel;
		env = c * env + (1 - c) * det;
		const gr = gainReductionDb(20 * Math.log10(env + 1e-12), params.thresholdDb, params.ratio, params.kneeDb);
		grSum += gr;
		const g = dbToGain(-gr) * makeup;
		outL[i] = (l[i] ?? 0) * g;
		outR[i] = (r[i] ?? 0) * g;
	}
	return {
		audioL: outL,
		audioR: outR,
		avgReductionDb: n ? grSum / n : 0
	};
}
/**
* Serial glue. Stage 1 is a fast RMS VCA using the knobs as set (the bus
* compressor role). Stage 2 is an optical-style leveler on the post-VCA
* level: slower attack, half the extra ratio, and a release that holds the
* slower of a 70 ms and a program memory. `opticalMix` 0 is stage 1 only.
* This is the topology, not a model of an SSL or an LA-2A.
*/
function compressSerialStereo(l, r, sampleRate, params, opticalMix) {
	const n = Math.min(l.length, r.length);
	const outL = new Float64Array(l.length);
	const outR = new Float64Array(r.length);
	const o = Math.max(0, Math.min(1, opticalMix));
	const atk1 = Math.exp(-1 / Math.max(1, params.attackMs / 1e3 * sampleRate));
	const rel1 = Math.exp(-1 / Math.max(1, params.releaseMs / 1e3 * sampleRate));
	const rmsC = 1 - Math.exp(-1 / Math.max(1, sampleRate * .008));
	const atk2 = Math.exp(-1 / Math.max(1, sampleRate * .012));
	const relFast = Math.exp(-1 / Math.max(1, sampleRate * .07));
	const slowMs = Math.max(400, params.releaseMs);
	const relSlow = Math.exp(-1 / Math.max(1, slowMs / 1e3 * sampleRate));
	const optThreshold = params.thresholdDb + 2;
	const optRatio = 1 + Math.max(0, params.ratio - 1) * .45;
	const optKnee = Math.max(params.kneeDb, 8);
	const makeup = dbToGain(params.makeupDb);
	let power = 0;
	let env1 = 0;
	let optFast = 0;
	let optSlow = 0;
	let grSum = 0;
	for (let i = 0; i < n; i++) {
		const det = Math.max(Math.abs(l[i] ?? 0), Math.abs(r[i] ?? 0));
		power += rmsC * (det * det - power);
		const rms = Math.sqrt(Math.max(0, power));
		const c1 = rms > env1 ? atk1 : rel1;
		env1 = c1 * env1 + (1 - c1) * rms;
		const g1 = dbToGain(-gainReductionDb(20 * Math.log10(env1 + 1e-12), params.thresholdDb, params.ratio, params.kneeDb));
		const post = rms * g1;
		const cFast = post > optFast ? atk2 : relFast;
		optFast = cFast * optFast + (1 - cFast) * post;
		const cSlow = post > optSlow ? atk2 : relSlow;
		optSlow = cSlow * optSlow + (1 - cSlow) * post;
		const g2 = g1 * dbToGain(-gainReductionDb(20 * Math.log10(Math.max(optFast, optSlow) + 1e-12), optThreshold, optRatio, optKnee));
		const g = g1 * (1 - o) + g2 * o;
		grSum += -20 * Math.log10(Math.max(1e-12, g));
		const a = g * makeup;
		outL[i] = (l[i] ?? 0) * a;
		outR[i] = (r[i] ?? 0) * a;
	}
	return {
		audioL: outL,
		audioR: outR,
		avgReductionDb: n ? grSum / n : 0
	};
}
/**
* Split-band dynamic cut. A 0 dB bandpass is scaled down when its own
* envelope exceeds the threshold, then mixed back. Broadband material outside
* the band is unchanged. Used for dynamic EQ and de-essing.
*/
function dynamicBandCut(x, sampleRate, freq, q, thresholdDb, ratio, attackMs, releaseMs, maxCutDb) {
	const band = new Float64Array(x);
	processBiquadInPlace(band, designBiquad("bandpass", freq, q, 0, sampleRate));
	const atk = Math.exp(-1 / Math.max(1, attackMs / 1e3 * sampleRate));
	const rel = Math.exp(-1 / Math.max(1, releaseMs / 1e3 * sampleRate));
	const floor = dbToGain(-Math.max(0, maxCutDb));
	let env = 0;
	const y = new Float64Array(x.length);
	for (let i = 0; i < x.length; i++) {
		const det = Math.abs(band[i] ?? 0);
		const c = det > env ? atk : rel;
		env = c * env + (1 - c) * det;
		const gr = gainReductionDb(20 * Math.log10(env + 1e-12), thresholdDb, ratio, 0);
		const depth = Math.max(floor, dbToGain(-gr));
		const g = Math.max(floor, depth);
		y[i] = (x[i] ?? 0) + (g - 1) * (band[i] ?? 0);
	}
	return y;
}
/**
* Transient shaper.
* `attack` and `sustain` are −1..+1.
* A fast envelope over a slow one marks transients. Attack scales that
* difference. Sustain scales the slow envelope relative to the dry peak,
* so a steady tone moves and a click mostly follows `attack`.
*/
function shapeTransients(x, sampleRate, attack, sustain) {
	const y = new Float64Array(x.length);
	const fastA = Math.exp(-1 / (sampleRate * 8e-4));
	const fastR = Math.exp(-1 / (sampleRate * .03));
	const slowA = Math.exp(-1 / (sampleRate * .025));
	const slowR = Math.exp(-1 / (sampleRate * .25));
	let fast = 0;
	let slow = 0;
	for (let i = 0; i < x.length; i++) {
		const a = Math.abs(x[i] ?? 0);
		fast = a > fast ? fastA * fast + (1 - fastA) * a : fastR * fast + (1 - fastR) * a;
		slow = a > slow ? slowA * slow + (1 - slowA) * a : slowR * slow + (1 - slowR) * a;
		const trans = Math.max(0, fast - slow) / (fast + 1e-9);
		const body = slow / (fast + 1e-9);
		const g = 1 + attack * trans * 1.4 + sustain * Math.min(1, body) * .85;
		y[i] = (x[i] ?? 0) * Math.max(0, g);
	}
	return y;
}
function bandIsActive(band) {
	if (!band.enabled) return false;
	if (band.type === "lowpass" || band.type === "highpass" || band.type === "notch" || band.type === "bandpass") return true;
	return Math.abs(band.gainDb) >= .05;
}
function coeffsFor(band, sampleRate, gainScale) {
	return designBiquad(band.type, band.freq, band.q, band.gainDb * gainScale, sampleRate);
}
/** Minimum-phase cascade, in place. Linear-phase uses forward-backward at half gain. */
function applyEqChannel(x, bands, sampleRate, mode) {
	const active = bands.filter(bandIsActive);
	if (active.length === 0) return;
	if (mode === "linear") {
		filtfiltInPlace(x, active.map((b) => coeffsFor(b, sampleRate, .5)));
		return;
	}
	processBiquadChainInPlace(x, active.map((b) => coeffsFor(b, sampleRate, 1)));
}
function applyEqStereo(l, r, bands, sampleRate, mode, target) {
	if (target === "stereo") {
		const outL = new Float64Array(l);
		const outR = new Float64Array(r);
		applyEqChannel(outL, bands, sampleRate, mode);
		applyEqChannel(outR, bands, sampleRate, mode);
		return {
			l: outL,
			r: outR
		};
	}
	const ms = encodeMidSide(l, r);
	if (target === "mid") applyEqChannel(ms.mid, bands, sampleRate, mode);
	else applyEqChannel(ms.side, bands, sampleRate, mode);
	return decodeMidSide(ms.mid, ms.side);
}
/** Realized magnitude in dB. Linear-phase plots |H_half|² so the curve matches what filtfilt does. */
function eqCurveDb(bands, sampleRate, mode, points = 240) {
	const active = bands.filter(bandIsActive);
	const out = [];
	const nyquist = sampleRate * .45;
	for (let i = 0; i < points; i++) {
		const t = i / (points - 1);
		const freq = 20 * Math.pow(nyquist / 20, t);
		let db = 0;
		if (mode === "minimum") for (const b of active) db += biquadMagnitudeDb(coeffsFor(b, sampleRate, 1), freq, sampleRate);
		else for (const b of active) db += 2 * biquadMagnitudeDb(coeffsFor(b, sampleRate, .5), freq, sampleRate);
		out.push({
			freq,
			db
		});
	}
	return out;
}
function slidingMinForward(x, win) {
	const n = x.length;
	const out = new Float64Array(n);
	const dq = new Int32Array(n);
	let h = 0;
	let t = 0;
	let r = 0;
	const w = Math.max(1, win);
	for (let i = 0; i < n; i++) {
		const end = Math.min(n, i + w);
		while (r < end) {
			while (t > h && (x[dq[t - 1] ?? 0] ?? 0) >= (x[r] ?? 0)) t--;
			dq[t++] = r;
			r++;
		}
		while (t > h && (dq[h] ?? 0) < i) h++;
		out[i] = x[dq[h] ?? 0] ?? 1;
	}
	return out;
}
/**
* Linked true-peak lookahead limiter.
* For each sample, the detector is the 4× interpolated peak across the
* lookahead window. Gain never rises faster than `releaseMs`.
* A signal already under the ceiling is passed through unchanged.
*/
function limitStereo(left, right, sampleRate, ceilingDb, releaseMs, lookaheadMs) {
	const n = Math.min(left.length, right.length);
	const ceiling = dbToGain(ceilingDb);
	const look = Math.max(1, Math.round(lookaheadMs / 1e3 * sampleRate));
	const desired = new Float64Array(n);
	const guard = ceiling * Math.pow(10, -3.2 / 20);
	const peaks = new Float64Array(n);
	writeIntervalPeaks(left, peaks, guard);
	let needs = false;
	for (let i = 0; i < n; i++) {
		const peak = peaks[i] ?? 0;
		if (peak > ceiling) {
			needs = true;
			desired[i] = ceiling / peak;
		} else desired[i] = 1;
	}
	writeIntervalPeaks(right, peaks, guard);
	for (let i = 0; i < n; i++) {
		const peak = peaks[i] ?? 0;
		if (peak > ceiling) {
			needs = true;
			const gain = ceiling / peak;
			if (gain < (desired[i] ?? 1)) desired[i] = gain;
		}
	}
	if (!needs) return {
		l: new Float64Array(left),
		r: new Float64Array(right),
		maxReductionDb: 0
	};
	const raw = slidingMinForward(desired, look);
	const rel = Math.exp(-1 / Math.max(1, releaseMs / 1e3 * sampleRate));
	const l = new Float64Array(n);
	const r = new Float64Array(n);
	let env = 1;
	let maxGr = 0;
	for (let i = 0; i < n; i++) {
		const target = raw[i] ?? 1;
		if (target < env) env = target;
		else env = rel * env + (1 - rel) * target;
		const gr = -gainToDb(env);
		if (gr > maxGr) maxGr = gr;
		l[i] = (left[i] ?? 0) * env;
		r[i] = (right[i] ?? 0) * env;
	}
	return {
		l,
		r,
		maxReductionDb: maxGr
	};
}
var OS = 8;
var TAPS = 129;
/** Two centered delays of MID high-rate samples. 128 / 8 = 16. */
var BASE_DELAY = 128 / OS;
function besselI0(x) {
	let sum = 1;
	let term = 1;
	const half = x * .5;
	for (let k = 1; k < 40; k++) {
		term *= half * half / (k * k);
		sum += term;
		if (term < sum * 1e-14) break;
	}
	return sum;
}
/** Lowpass in cycles per high-rate sample. Sum is normalized to 1. */
function designKaiserLowpass(cutoffCycles, taps, beta) {
	const h = new Float64Array(taps);
	const mid = (taps - 1) / 2;
	const i0b = besselI0(beta);
	let sum = 0;
	for (let i = 0; i < taps; i++) {
		const n = i - mid;
		const sinc = n === 0 ? 2 * cutoffCycles : Math.sin(2 * Math.PI * cutoffCycles * n) / (Math.PI * n);
		const r = mid === 0 ? 0 : n / mid;
		const v = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b);
		h[i] = v;
		sum += v;
	}
	const inv = sum === 0 ? 1 : 1 / sum;
	for (let i = 0; i < taps; i++) h[i] = (h[i] ?? 0) * inv;
	return h;
}
var kernelCache = null;
function kernel() {
	if (kernelCache) return kernelCache;
	const h = designKaiserLowpass(.055, TAPS, 8.6);
	const branches = [];
	for (let p = 0; p < OS; p++) {
		const n = Math.ceil((TAPS - p) / OS);
		const b = new Float64Array(n);
		for (let t = 0; t < n; t++) b[t] = h[p + t * OS] ?? 0;
		branches.push(b);
	}
	kernelCache = {
		h,
		branches
	};
	return kernelCache;
}
function clamp01(x) {
	return Math.max(0, Math.min(1, x));
}
function prepare(mode, driveDb, mix, osRate, options) {
	const memory = clamp01(options.memory ?? 0);
	const tubeTape = clamp01(options.tubeTapeMix ?? .5);
	const tubeAmt = mode === "tube" ? 1 : mode === "hybrid" ? 1 - tubeTape : 0;
	return {
		drive: Math.max(.01, Math.pow(10, driveDb / 20)),
		tubeAmt,
		memory,
		lowColor: Math.max(-1, Math.min(1, options.lowColor ?? 0)),
		highColor: Math.max(-1, Math.min(1, options.highColor ?? 0)),
		outputGain: Number.isFinite(options.outputGain) ? options.outputGain : 1,
		mix: clamp01(mix),
		lowA: Math.exp(-2 * Math.PI * 180 / osRate),
		highA: Math.exp(-2 * Math.PI * 5200 / osRate),
		kBias: 1 - Math.exp(-2 * Math.PI * 8 / osRate),
		playWidth: (.012 + .16 * memory) * Math.max(1, Math.pow(10, driveDb / 20))
	};
}
function shape(u, st, p) {
	let x = u;
	if (p.lowColor !== 0 || p.highColor !== 0) {
		if (!st.primed) {
			st.lp = u;
			st.hp = u;
			st.primed = true;
		}
		st.lp = p.lowA * st.lp + (1 - p.lowA) * x;
		st.hp = p.highA * st.hp + (1 - p.highA) * x;
		x = x + p.lowColor * st.lp * .7 + p.highColor * (x - st.hp) * .7;
	}
	const s = p.drive * (p.memory > 0 ? x + st.bias * .35 * p.memory : x);
	const tape = Math.tanh(s);
	const tube = s >= 0 ? 1 - Math.exp(-Math.min(60, s)) : -.72 * (1 - Math.exp(Math.max(-60, s / .72)));
	let y = tape * (1 - p.tubeAmt) + tube * p.tubeAmt;
	if (p.memory > 0) {
		const width = p.playWidth;
		if (y > st.flux + width) st.flux = y - width;
		else if (y < st.flux - width) st.flux = y + width;
		y = y * (1 - p.memory) + st.flux * p.memory;
		st.bias += p.kBias * (y - st.bias);
	}
	return y / p.drive;
}
/**
* Block processor. State is per call — offline renders do not leak across files.
* `process` returns a buffer the same length as the input, delay-compensated.
*/
var AnalogSaturationProcessor = class {
	process(x, sampleRate, mode, driveDb, mix, options = {}) {
		const p = prepare(mode, driveDb, mix, (sampleRate > 0 ? sampleRate : 48e3) * OS, options);
		const { h, branches } = kernel();
		const wet = new Float64Array(x.length);
		const ring = new Float64Array(TAPS);
		const st = {
			lp: 0,
			hp: 0,
			flux: 0,
			bias: 0,
			primed: false
		};
		const nIn = x.length + BASE_DELAY;
		let count = 0;
		for (let i = 0; i < nIn; i++) {
			for (let phase = 0; phase < OS; phase++) {
				const b = branches[phase] ?? branches[0];
				const taps = b?.length ?? 0;
				let acc = 0;
				for (let t = 0; t < taps; t++) {
					const j = i - t;
					if (j < 0) break;
					acc += (b?.[t] ?? 0) * (j < x.length ? x[j] ?? 0 : 0);
				}
				ring[count % TAPS] = shape(acc * OS, st, p);
				count++;
			}
			if (i >= BASE_DELAY && i - BASE_DELAY < x.length) {
				const newest = i * OS;
				let acc = 0;
				for (let k = 0; k < TAPS; k++) {
					const idx = newest - k;
					if (idx < 0) break;
					acc += (h[k] ?? 0) * (ring[idx % TAPS] ?? 0);
				}
				wet[i - BASE_DELAY] = acc;
			}
		}
		const y = new Float64Array(x.length);
		const m = p.mix;
		const g = p.outputGain;
		if (m <= 0) {
			if (g === 1) return new Float64Array(x);
			for (let i = 0; i < x.length; i++) y[i] = (x[i] ?? 0) * g;
			return y;
		}
		const dry = 1 - m;
		for (let i = 0; i < x.length; i++) y[i] = ((x[i] ?? 0) * dry + (wet[i] ?? 0) * m) * g;
		return y;
	}
};
function saturateChannel(x, mode, driveDb, mix, options = {}) {
	return new AnalogSaturationProcessor().process(x, options.sampleRate ?? 48e3, mode, driveDb, mix, options);
}
function clone(x) {
	return new Float64Array(x);
}
/**
* Offline mastering chain. Disabled stages are skipped, not approximated.
* Order: input gain → EQ → dynamic EQ → de-ess → multiband → glue →
* transient → saturation → width → center carve → true-peak limiter.
*/
function renderChain(input, params) {
	const notes = [];
	const sr = input.sampleRate;
	const peakIn = measureTruePeak([input.l, input.r]);
	const loudIn = measureLoudness([input.l, input.r], sr);
	let l = clone(input.l);
	let r = clone(input.r);
	applyGainInPlace(l, dbToGain(params.inputGainDb));
	applyGainInPlace(r, dbToGain(params.inputGainDb));
	const eq = applyEqStereo(l, r, params.bands, sr, params.eqMode, params.eqTarget);
	l = eq.l;
	r = eq.r;
	if (params.eqMode === "linear") notes.push("Linear-phase EQ is forward-backward filtering at half the knob gain, so the curve you see is the curve you hear. It does not shift phase. Transients can pre-ring.");
	if (params.dynamicEq.enabled) {
		const d = params.dynamicEq;
		l = dynamicBandCut(l, sr, d.freq, d.q, d.thresholdDb, d.ratio, d.attackMs, d.releaseMs, d.maxCutDb);
		r = dynamicBandCut(r, sr, d.freq, d.q, d.thresholdDb, d.ratio, d.attackMs, d.releaseMs, d.maxCutDb);
	}
	if (params.deEss.enabled) {
		const d = params.deEss;
		l = dynamicBandCut(l, sr, d.freq, d.q, d.thresholdDb, d.ratio, d.attackMs, d.releaseMs, d.maxCutDb);
		r = dynamicBandCut(r, sr, d.freq, d.q, d.thresholdDb, d.ratio, d.attackMs, d.releaseMs, d.maxCutDb);
		notes.push("De-esser is split-band. It only turns down the sibilance band, and only while that band is loud.");
	}
	if (params.multiband.enabled) {
		const mb = params.multiband;
		const leftBands = splitThreeBand(l, mb.lowHz, mb.highHz, sr);
		const rightBands = splitThreeBand(r, mb.lowHz, mb.highHz, sr);
		const low = compressStereo(leftBands.low, rightBands.low, sr, mb.low);
		const mid = compressStereo(leftBands.mid, rightBands.mid, sr, mb.mid);
		const high = compressStereo(leftBands.high, rightBands.high, sr, mb.high);
		l = new Float64Array(l.length);
		r = new Float64Array(r.length);
		for (let i = 0; i < l.length; i++) {
			l[i] = (low.audioL[i] ?? 0) + (mid.audioL[i] ?? 0) + (high.audioL[i] ?? 0);
			r[i] = (low.audioR[i] ?? 0) + (mid.audioR[i] ?? 0) + (high.audioR[i] ?? 0);
		}
		notes.push(`Multiband crossovers are linear-phase Linkwitz–Riley 4th-order at ${mb.lowHz} Hz and ${mb.highHz} Hz. Each split is one Butterworth section forward and back, so the sum is flat and in phase with the input.`);
	}
	let glueReduction = 0;
	if (params.glue.enabled) {
		const g = compressSerialStereo(l, r, sr, params.glue, params.glue.optical);
		l = g.audioL;
		r = g.audioR;
		glueReduction = g.avgReductionDb;
		notes.push("Glue is two stages in series. The first is a fast RMS VCA on your threshold, ratio, attack and release. The second is a slower optical-style leveler. Optical is how much of that second stage you hear.");
	}
	if (params.transient.enabled && (Math.abs(params.transient.attack) > .001 || Math.abs(params.transient.sustain) > .001)) {
		l = shapeTransients(l, sr, params.transient.attack, params.transient.sustain);
		r = shapeTransients(r, sr, params.transient.attack, params.transient.sustain);
	}
	if (params.saturation.enabled && params.saturation.mix > .001) {
		const s = params.saturation;
		const opts = {
			sampleRate: sr,
			memory: s.memory,
			lowColor: s.lowColor,
			highColor: s.highColor,
			tubeTapeMix: s.tubeTapeMix
		};
		l = saturateChannel(l, s.mode, s.driveDb, s.mix, opts);
		r = saturateChannel(r, s.mode, s.driveDb, s.mix, opts);
		notes.push(s.mode === "tube" ? "Tube is an 8× oversampled asymmetric exponential plus a hysteresis play operator. Even harmonics. It is not a valve." : s.mode === "hybrid" ? "Hybrid crossfades the tube curve into tanh at 8×, then the downsampler throws away harmonics above Nyquist." : "Tape is an 8× oversampled tanh plus a hysteresis play operator. Odd harmonics, unity small-signal gain. It is not a tape machine.");
	}
	if (Math.abs(params.width - 1) > .001) {
		const w = applyWidth(l, r, params.width);
		l = w.l;
		r = w.r;
	}
	if (params.carve > .001) {
		const carved = carveCenter(l, r, sr, params.carve, params.carveHz);
		l = carved.l;
		r = carved.r;
		notes.push(`Center carve ducks the side band around ${Math.round(params.carveHz)} Hz while the center of that band is loud. It does not pull a vocal out of other centered sounds.`);
	}
	let limiterReduction = 0;
	let latency = 0;
	if (params.limiter.enabled) {
		const lim = limitStereo(l, r, sr, params.limiter.ceilingDb, params.limiter.releaseMs, params.limiter.lookaheadMs);
		l = lim.l;
		r = lim.r;
		limiterReduction = lim.maxReductionDb;
		latency = Math.round(params.limiter.lookaheadMs / 1e3 * sr);
		if (limiterReduction < .05) notes.push("Limiter is armed and did not reduce gain. The signal was already under the ceiling.");
	}
	const peakOut = measureTruePeak([l, r]);
	const loudOut = measureLoudness([l, r], sr);
	return {
		l,
		r,
		sampleRate: sr,
		report: {
			samplePeakInDb: peakIn.samplePeakDb,
			samplePeakOutDb: gainToDb(Math.max(peakAbs(l), peakAbs(r))),
			truePeakInDb: peakIn.truePeakDb,
			truePeakOutDb: peakOut.truePeakDb,
			integratedIn: loudIn.integrated,
			integratedOut: loudOut.integrated,
			limiterReductionDb: limiterReduction,
			glueReductionDb: glueReduction,
			latencySamples: latency,
			notes
		}
	};
}
/** Playback-only gain so a louder master doesn't win the comparison. Capped at ±12 dB. */
function matchGainDb(fromLufs, toLufs) {
	if (!Number.isFinite(fromLufs) || !Number.isFinite(toLufs)) return 0;
	return Math.max(-12, Math.min(12, toLufs - fromLufs));
}
function noise(seed) {
	let a = seed >>> 0;
	return () => {
		a = Math.imul(1664525, a) + 1013904223 >>> 0;
		return a / 4294967296 * 2 - 1;
	};
}
/**
* Eight-second program and a cleaner print of the same arrangement.
* The reference is synthetic. It exists so spectral balance has a known target,
* not because it is a commercial master.
*/
function makeDemo(sampleRate = 48e3) {
	const n = Math.round(sampleRate * 8);
	const pl = new Float64Array(n);
	const pr = new Float64Array(n);
	const rl = new Float64Array(n);
	const rr = new Float64Array(n);
	const nz = noise(1096110657);
	const twoPi = Math.PI * 2;
	for (let i = 0; i < n; i++) {
		const t = i / sampleRate;
		const beat = t % .5;
		const kickEnv = beat < .45 ? Math.exp(-beat * 9) : 0;
		const kick = Math.sin(twoPi * (48 + 70 * Math.exp(-beat * 14)) * t) * kickEnv * .85;
		const bass = Math.sin(twoPi * 55 * t) * .34 + Math.sin(twoPi * 110 * t) * .08;
		const mud = Math.sin(twoPi * 240 * t) * .16 + Math.sin(twoPi * 480 * t) * .05;
		const chord = (Math.sin(twoPi * 196 * t) + Math.sin(twoPi * 247 * t) + Math.sin(twoPi * 294 * t)) * .045;
		const phrase = t % 2;
		const vocal = (phrase > .15 && phrase < 1.7 ? 1 : 0) * (Math.sin(twoPi * 185 * t) * .12 + Math.sin(twoPi * 370 * t) * .06 + Math.sin(twoPi * 3100 * t) * .035);
		const essGate = phrase > 1.15 && phrase < 1.45 ? Math.sin((phrase - 1.15) / .3 * Math.PI) : 0;
		const white = nz();
		const ess = white * essGate * .22;
		const hatBeat = t % .25;
		const hatEnv = hatBeat < .04 ? Math.exp(-hatBeat * 80) : 0;
		const hatL = white * hatEnv * .08;
		const hatR = white * hatEnv * .42;
		const wide = Math.sin(twoPi * 2470 * t) * .05 * Math.sin(twoPi * .5 * t);
		const programMono = kick + bass + mud + chord + vocal + ess * .85;
		pl[i] = programMono + hatL - wide;
		pr[i] = programMono + hatR + wide + ess * .15;
		const refMud = mud * .35;
		const refEss = ess * .25;
		const refVocal = vocal * 1.12;
		const refMono = kick * .95 + bass * .9 + refMud + chord * .85 + refVocal + refEss;
		rl[i] = refMono + hatL * .5 - wide * .35;
		rr[i] = refMono + hatR * .55 + wide * .35;
	}
	normalize(pl, pr, .7);
	normalize(rl, rr, .7);
	return {
		program: {
			l: pl,
			r: pr,
			sampleRate
		},
		reference: {
			l: rl,
			r: rr,
			sampleRate
		}
	};
}
function normalize(l, r, peak) {
	let m = 1e-9;
	for (let i = 0; i < l.length; i++) m = Math.max(m, Math.abs(l[i] ?? 0), Math.abs(r[i] ?? 0));
	const g = peak / m;
	for (let i = 0; i < l.length; i++) {
		l[i] = (l[i] ?? 0) * g;
		r[i] = (r[i] ?? 0) * g;
	}
}
/** EBU-style alignment tone: stereo 1 kHz at −23 dBFS. Integrated loudness should read −23 LUFS. */
function calibrationTone(sampleRate = 48e3, seconds = 2) {
	const n = Math.round(sampleRate * seconds);
	const amp = Math.pow(10, -23 / 20);
	const l = new Float64Array(n);
	const r = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const s = Math.sin(2 * Math.PI * 1e3 * i / sampleRate) * amp;
		l[i] = s;
		r[i] = s;
	}
	return {
		l,
		r,
		sampleRate
	};
}
function fmt$1(n, digits = 1) {
	if (!Number.isFinite(n)) return "—";
	return n.toFixed(digits);
}
/**
* Evidence-backed notes. Nothing here is applied until the user auditions it.
* Suggestions prefer a small cut or a dynamic move over a permanent boost.
*/
function suggest(analysis, targetLufs = -14) {
	const base = neutralParams();
	const findings = [];
	if (analysis.clippedSamples > 0) findings.push({
		id: "clip",
		title: "The file is already clipped",
		evidence: `${analysis.clippedSamples} samples at or above full scale. Sample peak ${fmt$1(analysis.samplePeakDb)} dBFS, true peak ${fmt$1(analysis.truePeakDb)} dBTP.`,
		action: "Fix this in the mix. A limiter cannot restore flattened peaks.",
		sideEffect: "No processing suggestion. Reconstruction would be a guess.",
		confidence: "high",
		patch: null
	});
	if (Math.abs(analysis.dcL) > .002 || Math.abs(analysis.dcR) > .002) {
		const bands = base.bands.map((b) => b.id === "hp" ? {
			...b,
			enabled: true,
			freq: 18,
			q: .707
		} : b);
		findings.push({
			id: "dc",
			title: "DC offset",
			evidence: `Left mean ${analysis.dcL.toExponential(2)}, right mean ${analysis.dcR.toExponential(2)}.`,
			action: "Audition a gentle 18 Hz high-pass. It removes the offset without a loud tonal change.",
			sideEffect: "A high-pass this low can soften the very deepest sub hit.",
			confidence: "high",
			patch: { bands }
		});
	}
	const loudGap = targetLufs - analysis.integratedLufs;
	if (Number.isFinite(analysis.integratedLufs) && loudGap > 1.5) findings.push({
		id: "quiet",
		title: "Quieter than the streaming target",
		evidence: `Integrated loudness is ${fmt$1(analysis.integratedLufs)} LUFS. The selected target is ${fmt$1(targetLufs, 0)} LUFS, about ${fmt$1(loudGap)} LU lower. True peak is ${fmt$1(analysis.truePeakDb)} dBTP.`,
		action: loudGap > 8 ? "Do not make up this entire gap with the limiter. Raise the mix level, then limit the last 3–6 dB." : "A few dB of input gain into the −1 dBTP limiter will close most of the gap. Listen for dulling of transients.",
		sideEffect: "More limiting lowers crest factor. Punch goes before loudness does.",
		confidence: loudGap > 8 ? "high" : "medium",
		patch: loudGap > 8 ? { inputGainDb: 4 } : { inputGainDb: Math.min(6, Math.max(0, loudGap - .5)) }
	});
	else if (Number.isFinite(analysis.integratedLufs) && analysis.integratedLufs > targetLufs + 1) findings.push({
		id: "hot",
		title: "Hotter than the streaming target",
		evidence: `Integrated loudness is ${fmt$1(analysis.integratedLufs)} LUFS against a ${fmt$1(targetLufs, 0)} LUFS target. Crest factor is ${fmt$1(analysis.crestDb)} dB.`,
		action: "Turn the input down. Streaming encoders will turn it down anyway, often with their own limiter.",
		sideEffect: "None beyond level. You keep the dynamics you already printed.",
		confidence: "high",
		patch: { inputGainDb: Math.max(-12, targetLufs - analysis.integratedLufs) }
	});
	if (analysis.truePeakDb > -.3) findings.push({
		id: "tp",
		title: "True peak is high",
		evidence: `True peak ${fmt$1(analysis.truePeakDb)} dBTP, sample peak ${fmt$1(analysis.samplePeakDb)} dBFS. The gap is inter-sample overshoot.`,
		action: "Leave the limiter ceiling at −1.0 dBTP or lower before a lossy encode.",
		sideEffect: "Lookahead limiting can soften the initial transient if it is working hard.",
		confidence: "high",
		patch: { limiter: {
			...base.limiter,
			enabled: true,
			ceilingDb: -1
		} }
	});
	if (analysis.correlation < .2) findings.push({
		id: "phase",
		title: "Stereo correlation is low",
		evidence: `Correlation ${fmt$1(analysis.correlation, 2)}. Side energy is ${fmt$1(analysis.sideEnergyRatio * 100, 0)}% of the mid/side total.`,
		action: "Hit Mono in the transport and listen. Narrow the width if the chorus or vocal thins out.",
		sideEffect: "Width below 1.0 pulls the side toward the center. It does not remix individual instruments.",
		confidence: analysis.correlation < 0 ? "high" : "medium",
		patch: { width: .7 }
	});
	if (analysis.subEnergyRatio > .35) findings.push({
		id: "sub",
		title: "A lot of energy sits below 80 Hz",
		evidence: `${fmt$1(analysis.subEnergyRatio * 100, 0)}% of the measured spectral power is between 20 and 80 Hz. Small speakers will not reproduce it.`,
		action: "Use the small-speaker monitor. If the bass part vanishes, the part is living only in the sub — check the octave above, not just the level.",
		sideEffect: "This is a monitoring check, not a cut. A high-pass is a separate decision.",
		confidence: "medium",
		patch: null
	});
	const ess = analysis.sibilanceDb - analysis.presenceDb;
	if (ess > 3) findings.push({
		id: "ess",
		title: "Sibilance band outweighs presence",
		evidence: `5–10 kHz averages ${fmt$1(analysis.sibilanceDb)} dB, presence (2–5 kHz) averages ${fmt$1(analysis.presenceDb)} dB, a ${fmt$1(ess)} dB tilt toward the ess band.`,
		action: "Audition the split-band de-esser before adding a high shelf. Brightness that comes from 7–9 kHz is often harshness, not clarity.",
		sideEffect: "Too much de-essing dulls consonants and cymbals together, because this stage does not know which is which.",
		confidence: "medium",
		patch: { deEss: {
			...base.deEss,
			enabled: true,
			thresholdDb: -32,
			maxCutDb: 3,
			freq: 7500
		} }
	});
	const top = analysis.resonances[0];
	if (top && top.excessDb >= 6) {
		const bands = base.bands.map((b) => b.id === "mud" || b.id === "presence" ? b.id === "mud" ? {
			...b,
			type: "peaking",
			freq: Math.round(top.freq),
			gainDb: -Math.min(3, top.excessDb / 2),
			q: 2.2,
			enabled: true
		} : b : b);
		findings.push({
			id: "resonance",
			title: `Narrow rise near ${Math.round(top.freq)} Hz`,
			evidence: `That third is ${fmt$1(top.excessDb)} dB above its neighbors, at ${fmt$1(top.levelDb)} dB. A resonance can be a snare, a voice, or a problem. The measurement cannot tell.`,
			action: `Audition a −${fmt$1(Math.min(3, top.excessDb / 2))} dB bell, Q 2.2, and bypass it. Keep it only if the note stops honking and the instrument still sounds like itself.`,
			sideEffect: "A static cut is always on, including in sections where the resonance is not.",
			confidence: "low",
			patch: { bands }
		});
	}
	if (findings.length === 0) findings.push({
		id: "clear",
		title: "No obvious technical fault",
		evidence: `Integrated ${fmt$1(analysis.integratedLufs)} LUFS, true peak ${fmt$1(analysis.truePeakDb)} dBTP, correlation ${fmt$1(analysis.correlation, 2)}, crest ${fmt$1(analysis.crestDb)} dB.`,
		action: "If you still dislike it, the reason is musical. Compare against your reference at matched loudness before adding processing.",
		sideEffect: "None.",
		confidence: "medium",
		patch: null
	});
	return findings;
}
function applyPatch(current, patch) {
	return {
		...current,
		...patch,
		bands: patch.bands ?? current.bands,
		dynamicEq: patch.dynamicEq ?? current.dynamicEq,
		deEss: patch.deEss ?? current.deEss,
		multiband: patch.multiband ?? current.multiband,
		glue: patch.glue ?? current.glue,
		transient: patch.transient ?? current.transient,
		saturation: patch.saturation ?? current.saturation,
		limiter: patch.limiter ?? current.limiter
	};
}
var job = 0;
var worker = null;
function copyStereo(audio) {
	return {
		l: audio.l.slice(),
		r: audio.r.slice(),
		sampleRate: audio.sampleRate
	};
}
function applyWorkerMessage(msg) {
	if (msg.id !== job) return;
	if (msg.op === "error") {
		useSession.setState({
			busy: null,
			error: `${msg.message} The original still plays.`
		});
		return;
	}
	if (msg.op === "analyze") {
		useSession.setState({
			refAnalysis: msg.analysis,
			busy: null
		});
		return;
	}
	const rendered = {
		l: msg.l,
		r: msg.r,
		sampleRate: msg.sampleRate
	};
	if (msg.op === "render") {
		useSession.setState({
			rendered,
			report: msg.report,
			busy: null,
			error: null
		});
		return;
	}
	useSession.setState({
		analysis: msg.analysis,
		refAnalysis: msg.refAnalysis,
		findings: msg.findings,
		rendered,
		report: msg.report,
		busy: null
	});
}
function runSync(request) {
	if (request.id !== job) return;
	try {
		if (request.op === "analyze") {
			applyWorkerMessage({
				id: request.id,
				op: "analyze",
				analysis: analyze(request.audio.l, request.audio.r, request.audio.sampleRate)
			});
			return;
		}
		if (request.op === "render") {
			const rendered = renderChain(request.audio, request.params);
			applyWorkerMessage({
				id: request.id,
				op: "render",
				l: rendered.l,
				r: rendered.r,
				sampleRate: rendered.sampleRate,
				report: rendered.report
			});
			return;
		}
		const analysis = analyze(request.audio.l, request.audio.r, request.audio.sampleRate);
		const refAnalysis = request.reference ? analyze(request.reference.l, request.reference.r, request.reference.sampleRate) : null;
		const rendered = renderChain(request.audio, request.params);
		applyWorkerMessage({
			id: request.id,
			op: "full",
			analysis,
			refAnalysis,
			findings: suggest(analysis, request.targetLufs),
			l: rendered.l,
			r: rendered.r,
			sampleRate: rendered.sampleRate,
			report: rendered.report
		});
	} catch (error) {
		applyWorkerMessage({
			id: request.id,
			op: "error",
			message: error instanceof Error ? error.message : "Could not measure that file."
		});
	}
}
/** Measure and render off the main thread so Play keeps working. */
function dispatch(request) {
	if (typeof window === "undefined" || typeof Worker === "undefined") {
		setTimeout(() => runSync(request), 0);
		return;
	}
	try {
		const audio = copyStereo(request.audio);
		const reference = request.op === "full" && request.reference ? copyStereo(request.reference) : null;
		const payload = request.op === "full" ? {
			...request,
			audio,
			reference
		} : {
			...request,
			audio
		};
		const transfers = [audio.l.buffer, audio.r.buffer];
		if (reference) transfers.push(reference.l.buffer, reference.r.buffer);
		worker?.terminate();
		worker = new Worker(new URL("../dsp/offline.worker.ts", import.meta.url), { type: "module" });
		const id = request.id;
		let settled = false;
		worker.onmessage = (event) => {
			settled = true;
			applyWorkerMessage(event.data);
		};
		worker.onerror = () => {
			if (settled || id !== job) return;
			settled = true;
			worker?.terminate();
			worker = null;
			runSync(request);
		};
		worker.postMessage(payload, transfers);
	} catch {
		runSync(request);
	}
}
var useSession = create((set, get) => ({
	program: null,
	reference: null,
	programName: "",
	referenceName: "",
	analysis: null,
	refAnalysis: null,
	params: neutralParams(),
	rendered: null,
	report: null,
	findings: [],
	busy: null,
	error: null,
	source: "processed",
	monitor: "full",
	matchLoudness: true,
	targetLufs: -14,
	moduleId: "eq",
	loadDemo: () => {
		const id = ++job;
		set({
			busy: "Measuring the house program",
			error: null
		});
		setTimeout(() => {
			if (id !== job) return;
			try {
				const demo = makeDemo();
				const { params, targetLufs } = get();
				set({
					program: demo.program,
					reference: demo.reference,
					programName: "House program",
					referenceName: "Cleaner print",
					analysis: null,
					refAnalysis: null,
					findings: [],
					rendered: null,
					report: null,
					busy: "Measuring. Original can play."
				});
				dispatch({
					id,
					op: "full",
					audio: demo.program,
					reference: demo.reference,
					params,
					targetLufs
				});
			} catch (error) {
				set({
					busy: null,
					error: error instanceof Error ? error.message : "Could not build the program"
				});
			}
		}, 30);
	},
	loadCalibration: () => {
		const id = ++job;
		set({
			busy: "Measuring the alignment tone",
			error: null
		});
		setTimeout(() => {
			if (id !== job) return;
			try {
				const tone = calibrationTone();
				const { params, targetLufs } = get();
				set({
					program: tone,
					reference: null,
					programName: "1 kHz, −23 dBFS",
					referenceName: "",
					analysis: null,
					refAnalysis: null,
					findings: [],
					rendered: null,
					report: null,
					busy: "Measuring. Original can play."
				});
				dispatch({
					id,
					op: "full",
					audio: tone,
					reference: null,
					params,
					targetLufs
				});
			} catch (error) {
				set({
					busy: null,
					error: error instanceof Error ? error.message : "Could not build the tone"
				});
			}
		}, 30);
	},
	loadProgram: (name, audio) => {
		const id = ++job;
		const previousRef = get().reference;
		const sameRate = previousRef && previousRef.sampleRate === audio.sampleRate ? previousRef : null;
		const rateError = previousRef && !sameRate ? `Reference is ${previousRef.sampleRate} Hz and this file is ${audio.sampleRate} Hz, so the balance view was cleared.` : null;
		const { params, targetLufs } = get();
		set({
			busy: "Measuring. Original can play.",
			error: rateError,
			programName: name,
			program: audio,
			reference: sameRate,
			referenceName: sameRate ? get().referenceName : "",
			analysis: null,
			refAnalysis: sameRate ? get().refAnalysis : null,
			findings: [],
			rendered: null,
			report: null
		});
		const reference = sameRate;
		setTimeout(() => {
			if (id !== job) return;
			dispatch({
				id,
				op: "full",
				audio,
				reference,
				params,
				targetLufs
			});
		}, 0);
	},
	loadReference: (name, audio) => {
		const program = get().program;
		if (!program) {
			set({ error: "Load a program before a reference." });
			return;
		}
		if (audio.sampleRate !== program.sampleRate) {
			set({ error: `Reference is ${audio.sampleRate} Hz and the program is ${program.sampleRate} Hz. Balance comparison needs the same rate.` });
			return;
		}
		const id = ++job;
		set({
			reference: audio,
			referenceName: name,
			refAnalysis: null,
			busy: "Measuring the reference. It can play.",
			error: null
		});
		dispatch({
			id,
			op: "analyze",
			audio
		});
	},
	setParams: (params) => {
		set({ params });
		const id = ++job;
		if (!get().program) return;
		set({ busy: "Rendering. Original can play." });
		setTimeout(() => {
			if (id !== job) return;
			const state = get();
			if (!state.program) return;
			if (!state.analysis) {
				dispatch({
					id,
					op: "full",
					audio: state.program,
					reference: state.reference,
					params,
					targetLufs: state.targetLufs
				});
				return;
			}
			dispatch({
				id,
				op: "render",
				audio: state.program,
				params
			});
		}, 40);
	},
	patchParams: (patch) => {
		const next = applyPatch(get().params, patch);
		get().setParams(next);
	},
	setSource: (source) => set({ source }),
	setMonitor: (monitor) => set({ monitor }),
	setMatch: (matchLoudness) => set({ matchLoudness }),
	setTarget: (targetLufs) => {
		const analysis = get().analysis;
		set({
			targetLufs,
			findings: analysis ? suggest(analysis, targetLufs) : []
		});
	},
	setModule: (moduleId) => set({ moduleId })
}));
function playbackGainDb(state) {
	if (!state.matchLoudness || !state.analysis) return 0;
	const target = state.analysis.integratedLufs;
	if (state.source === "processed" && state.report) return matchGainDb(state.report.integratedOut, target);
	if (state.source === "reference" && state.refAnalysis) return matchGainDb(state.refAnalysis.integratedLufs, target);
	return 0;
}
function balanceOf(state) {
	if (!state.analysis || !state.refAnalysis) return [];
	return spectralDelta(state.analysis.thirds, state.refAnalysis.thirds);
}
var W = 1e3;
var H = 360;
function spectrumPoints(spec, w, h) {
	const minF = Math.log(20);
	const maxF = Math.log(2e4);
	const dbFloor = -72;
	const parts = [];
	const steps = 240;
	for (let i = 0; i < steps; i++) {
		const x = i / 239 * w;
		const freq = Math.exp(minF + i / 239 * (maxF - minF));
		const bin = Math.min(spec.spectrumDb.length - 1, Math.max(1, Math.round(freq / spec.spectrumBinHz)));
		const y = 8 + (0 - Math.max(dbFloor, Math.min(0, spec.spectrumDb[bin] ?? dbFloor))) / 72 * (h - 28);
		parts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
	}
	return parts.join(" ");
}
function SpectrumPlot({ analysis, reference }) {
	const program = analysis ? spectrumPoints(analysis, W, H) : "";
	const refLine = reference ? spectrumPoints(reference, W, H) : "";
	const grid = [
		50,
		100,
		200,
		500,
		1e3,
		2e3,
		5e3,
		1e4
	];
	const minF = Math.log(20);
	const maxF = Math.log(2e4);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		viewBox: `0 0 ${W} ${H}`,
		className: "h-36 w-full rounded-md bg-bg lg:h-48",
		role: "img",
		"aria-label": "Spectrum of the program and reference",
		children: [
			grid.map((freq) => {
				const x = (Math.log(freq) - minF) / (maxF - minF) * W;
				const label = freq >= 1e3 ? `${freq / 1e3}k` : `${freq}`;
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", {
					className: "text-line",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
						x1: x,
						y1: 0,
						x2: x,
						y2: H,
						stroke: "currentColor",
						strokeWidth: "1"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", {
						x: x + 6,
						y: 352,
						className: "fill-faint",
						fontSize: "16",
						fontFamily: "IBM Plex Mono, ui-monospace, monospace",
						children: label
					})]
				}, freq);
			}),
			[
				-12,
				-24,
				-48
			].map((db) => {
				const y = 8 + (0 - db) / 72 * 332;
				return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
					x1: 0,
					y1: y,
					x2: W,
					y2: y,
					className: "text-line",
					stroke: "currentColor",
					strokeWidth: "1"
				}, db);
			}),
			refLine && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polyline", {
				points: refLine,
				fill: "none",
				className: "text-fg",
				stroke: "currentColor",
				strokeWidth: "1.5"
			}),
			program && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polyline", {
				points: program,
				fill: "none",
				className: "text-amber",
				stroke: "currentColor",
				strokeWidth: "2.5"
			})
		]
	});
}
function Waveform({ left, progress }) {
	const shape = (0, import_react.useMemo)(() => {
		if (!left) return null;
		const buckets = 400;
		const min = new Float64Array(buckets);
		const max = new Float64Array(buckets);
		const n = left.length;
		for (let b = 0; b < buckets; b++) {
			const a = Math.floor(b * n / buckets);
			const c = Math.max(a + 1, Math.floor((b + 1) * n / buckets));
			let lo = 0;
			let hi = 0;
			for (let i = a; i < c && i < n; i++) {
				const v = left[i] ?? 0;
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			min[b] = lo;
			max[b] = hi;
		}
		return {
			min,
			max
		};
	}, [left]);
	const points = (0, import_react.useMemo)(() => {
		if (!shape) return "";
		const top = [];
		const bottom = [];
		const mid = 50;
		for (let i = 0; i < shape.max.length; i++) {
			const x = i / (shape.max.length - 1) * 1e3;
			top.push(`${x.toFixed(1)},${(mid - (shape.max[i] ?? 0) * 42).toFixed(1)}`);
			bottom.push(`${x.toFixed(1)},${(mid - (shape.min[i] ?? 0) * 42).toFixed(1)}`);
		}
		return `${top.join(" ")} ${bottom.reverse().join(" ")}`;
	}, [shape]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		viewBox: "0 0 1000 100",
		className: "h-16 w-full rounded-md bg-bg",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
				x1: "0",
				y1: "50",
				x2: "1000",
				y2: "50",
				className: "text-line",
				stroke: "currentColor",
				strokeWidth: "1"
			}),
			points && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polygon", {
				points,
				className: "fill-amber text-amber",
				opacity: "0.9"
			}),
			progress > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
				x1: progress * 1e3,
				y1: "0",
				x2: progress * 1e3,
				y2: "100",
				className: "text-fg",
				stroke: "currentColor",
				strokeWidth: "2"
			})
		]
	});
}
function EqCurve({ points }) {
	const minF = Math.log(20);
	const maxF = Math.log(2e4);
	const line = points.map((p) => {
		const x = (Math.log(p.freq) - minF) / (maxF - minF) * 1e3;
		const y = 60 - Math.max(-18, Math.min(18, p.db)) / 18 * 48;
		return `${x.toFixed(1)},${y.toFixed(1)}`;
	}).join(" ");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		viewBox: "0 0 1000 120",
		className: "h-24 w-full rounded-md bg-bg",
		role: "img",
		"aria-label": "Realized equalizer magnitude",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
			x1: "0",
			y1: "60",
			x2: "1000",
			y2: "60",
			className: "text-line",
			stroke: "currentColor",
			strokeWidth: "1"
		}), line && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polyline", {
			points: line,
			fill: "none",
			className: "text-amber",
			stroke: "currentColor",
			strokeWidth: "2.5"
		})]
	});
}
var STREAMING_TARGETS = [
	{
		id: "spotify",
		name: "Spotify / YouTube",
		lufs: -14,
		truePeak: -1
	},
	{
		id: "apple",
		name: "Apple Music",
		lufs: -16,
		truePeak: -1
	},
	{
		id: "amazon",
		name: "Amazon Music",
		lufs: -14,
		truePeak: -2
	},
	{
		id: "ebu",
		name: "EBU R 128 broadcast",
		lufs: -23,
		truePeak: -1
	},
	{
		id: "hot",
		name: "Hot / club (optional)",
		lufs: -9,
		truePeak: -1
	}
];
function fmt(value, digits = 1) {
	if (!Number.isFinite(value)) return "—";
	return value.toFixed(digits);
}
function Readout({ label, value, unit, hot = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-end justify-between gap-3 border-b border-line py-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-xs uppercase tracking-wide text-muted",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: `font-mono text-xl tabular-nums ${hot ? "text-clip" : "text-fg"}`,
			children: [value, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "ml-1 text-xs text-muted",
				children: unit
			})]
		})]
	});
}
function Meters({ analysis, report, targetLufs, onTarget }) {
	const outHot = (report?.truePeakOutDb ?? -99) > -.2;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-lg border border-line bg-surface p-4",
		"aria-label": "Meters",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mb-3 flex items-center justify-between gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "text-sm font-medium",
					children: "Meters"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-xs text-muted",
					children: "BS.1770 · 4× peak"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "mb-3 flex flex-col gap-1 text-xs text-muted",
				children: ["Loudness target", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
					className: "h-11 rounded-md border border-line bg-bg px-2 text-sm text-fg",
					value: targetLufs,
					onChange: (event) => onTarget(Number(event.target.value)),
					children: STREAMING_TARGETS.map((target) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
						value: target.lufs,
						children: [
							target.name,
							" · ",
							target.lufs,
							" LUFS / ",
							target.truePeak,
							" dBTP"
						]
					}, target.id))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-2 gap-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-mono text-xs text-amber",
						children: "In"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
						label: "LUFS I",
						value: fmt(analysis?.integratedLufs ?? NaN),
						unit: ""
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
						label: "True peak",
						value: fmt(analysis?.truePeakDb ?? NaN),
						unit: "dBTP",
						hot: (analysis?.truePeakDb ?? -99) > -.2
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
						label: "Crest",
						value: fmt(analysis?.crestDb ?? NaN),
						unit: "dB"
					})
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-mono text-xs text-amber",
						children: "Out"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
						label: "LUFS I",
						value: fmt(report?.integratedOut ?? NaN),
						unit: ""
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
						label: "True peak",
						value: fmt(report?.truePeakOutDb ?? NaN),
						unit: "dBTP",
						hot: outHot
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
						label: "Limiting",
						value: fmt(report?.limiterReductionDb ?? NaN),
						unit: "dB"
					})
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mb-1 flex justify-between text-xs text-muted",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Correlation" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono tabular-nums text-fg",
							children: fmt(analysis?.correlation ?? NaN, 2)
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "relative h-3 rounded-full bg-bg",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute top-0 left-1/2 h-full w-px bg-line" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber",
							style: { left: `${((analysis?.correlation ?? 0) + 1) / 2 * 100}%` }
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-1 flex justify-between font-mono text-xs text-faint",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "−1" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "0" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "+1" })
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
				className: "mt-3 grid grid-cols-2 gap-2 text-xs",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-muted",
						children: "Short-term max"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", {
						className: "font-mono tabular-nums",
						children: [fmt(analysis?.shortTermMaxLufs ?? NaN), " LUFS"]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-muted",
						children: "Loudness range"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", {
						className: "font-mono tabular-nums",
						children: [fmt(analysis?.loudnessRange ?? NaN), " LU"]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-muted",
						children: "Sample peak"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", {
						className: "font-mono tabular-nums",
						children: [fmt(analysis?.samplePeakDb ?? NaN), " dBFS"]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-muted",
						children: "Side energy"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", {
						className: "font-mono tabular-nums",
						children: [fmt((analysis?.sideEnergyRatio ?? 0) * 100, 0), "%"]
					})] })
				]
			})
		]
	});
}
function Knob({ label, value, min, max, step, unit, onChange }) {
	const shown = Number.isInteger(step) ? value.toFixed(0) : value.toFixed(step < .1 ? 2 : 1);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "flex min-w-0 flex-col gap-1",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "flex items-baseline justify-between gap-3 text-xs text-muted",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "font-mono tabular-nums text-fg",
				children: [shown, unit]
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			type: "range",
			min,
			max,
			step,
			value,
			"aria-label": label,
			onChange: (event) => onChange(Number(event.target.value))
		})]
	});
}
function Toggle({ on, label, onClick }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		"aria-pressed": on,
		onClick,
		className: `h-11 rounded-md px-3 text-sm ${on ? "bg-amber text-ink" : "bg-bg text-fg"}`,
		children: label
	});
}
var MATH = {
	map: "Analysis taps the input. It does not sit in the processing path, so bypassing a module never changes a measurement of the source.",
	input: "Output = input × 10^(dB/20). This is the only place a streaming loudness gap should be closed before the limiter.",
	eq: "Minimum phase: RBJ cookbook biquads, direct form II transposed. Linear phase: the same filters forward and back at half the knob gain, so you hear the curve on screen, with no phase shift and some pre-ring.",
	dynamic: "A 0 dB bandpass is attenuated only while its own envelope is over the threshold, then mixed back. Material outside the band is untouched.",
	deess: "Same split-band cut, aimed at 5–9 kHz. It cannot tell a vocal ess from a cymbal.",
	multiband: "Linear-phase Linkwitz–Riley 4. One Butterworth section run forward and back, so the magnitude is 24 dB/octave and the phase is zero. The three bands sum flat without an extra allpass.",
	glue: "Serial glue. Stage 1 is a fast RMS VCA on these knobs. Stage 2 is a slower optical-style leveler with a softer ratio and a two-speed release. Optical is the blend. Not an SSL, not an LA-2A.",
	transient: "Fast envelope minus slow envelope marks the attack. Attack scales that difference. Sustain scales the slow body. Zero and zero is a bypass.",
	saturation: "8× Kaiser anti-alias around a waveshaper. Tape is tanh (odd harmonics). Tube is an asymmetric exponential (even harmonics). Hybrid crossfades them. Memory is a hysteresis play operator plus a slow bias. Not a tape machine or a valve.",
	image: "Width scales the side only. Width 0 is mono. Width 1 is bypass. Carve ducks the side band around the focus frequency while the center of that band is loud. It does not separate a vocal from other centered sounds.",
	limiter: "Lookahead true-peak limiter. The detector is a 4× sinc peak. Gain falls immediately and releases with a one-pole. A signal under the ceiling is bit-identical."
};
function ModulePanel({ moduleId, params, sampleRate, onChange }) {
	const set = (patch) => onChange({
		...params,
		...patch
	});
	const curve = moduleId === "eq" ? eqCurveDb(params.bands, sampleRate, params.eqMode) : [];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-lg border border-line bg-surface p-4",
		"aria-label": "Module controls",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-sm text-pretty text-muted",
			children: MATH[moduleId]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-4",
			children: [
				moduleId === "map" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Map, {}),
				moduleId === "input" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
					label: "Input gain",
					value: params.inputGainDb,
					min: -12,
					max: 12,
					step: .1,
					unit: " dB",
					onChange: (inputGainDb) => set({ inputGainDb })
				}),
				moduleId === "eq" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EqControls, {
					params,
					curve,
					onChange
				}),
				moduleId === "dynamic" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DynCut, {
					enabled: params.dynamicEq.enabled,
					freq: params.dynamicEq.freq,
					q: params.dynamicEq.q,
					threshold: params.dynamicEq.thresholdDb,
					maxCut: params.dynamicEq.maxCutDb,
					onToggle: () => set({ dynamicEq: {
						...params.dynamicEq,
						enabled: !params.dynamicEq.enabled
					} }),
					onFreq: (freq) => set({ dynamicEq: {
						...params.dynamicEq,
						freq,
						enabled: true
					} }),
					onQ: (q) => set({ dynamicEq: {
						...params.dynamicEq,
						q
					} }),
					onThreshold: (thresholdDb) => set({ dynamicEq: {
						...params.dynamicEq,
						thresholdDb,
						enabled: true
					} }),
					onCut: (maxCutDb) => set({ dynamicEq: {
						...params.dynamicEq,
						maxCutDb,
						enabled: true
					} })
				}),
				moduleId === "deess" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DynCut, {
					enabled: params.deEss.enabled,
					freq: params.deEss.freq,
					q: params.deEss.q,
					threshold: params.deEss.thresholdDb,
					maxCut: params.deEss.maxCutDb,
					onToggle: () => set({ deEss: {
						...params.deEss,
						enabled: !params.deEss.enabled
					} }),
					onFreq: (freq) => set({ deEss: {
						...params.deEss,
						freq,
						enabled: true
					} }),
					onQ: (q) => set({ deEss: {
						...params.deEss,
						q
					} }),
					onThreshold: (thresholdDb) => set({ deEss: {
						...params.deEss,
						thresholdDb,
						enabled: true
					} }),
					onCut: (maxCutDb) => set({ deEss: {
						...params.deEss,
						maxCutDb,
						enabled: true
					} })
				}),
				moduleId === "multiband" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Multiband, {
					params,
					onChange
				}),
				moduleId === "glue" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid gap-4 sm:grid-cols-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
							on: params.glue.enabled,
							label: params.glue.enabled ? "Glue on" : "Glue off",
							onClick: () => set({ glue: {
								...params.glue,
								enabled: !params.glue.enabled
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Threshold",
							value: params.glue.thresholdDb,
							min: -40,
							max: 0,
							step: .5,
							unit: " dB",
							onChange: (thresholdDb) => set({ glue: {
								...params.glue,
								thresholdDb,
								enabled: true
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Ratio",
							value: params.glue.ratio,
							min: 1,
							max: 8,
							step: .1,
							unit: ":1",
							onChange: (ratio) => set({ glue: {
								...params.glue,
								ratio,
								enabled: true
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Attack",
							value: params.glue.attackMs,
							min: 1,
							max: 80,
							step: 1,
							unit: " ms",
							onChange: (attackMs) => set({ glue: {
								...params.glue,
								attackMs
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Release",
							value: params.glue.releaseMs,
							min: 20,
							max: 400,
							step: 1,
							unit: " ms",
							onChange: (releaseMs) => set({ glue: {
								...params.glue,
								releaseMs
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Knee",
							value: params.glue.kneeDb,
							min: 0,
							max: 18,
							step: .5,
							unit: " dB",
							onChange: (kneeDb) => set({ glue: {
								...params.glue,
								kneeDb
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Makeup",
							value: params.glue.makeupDb,
							min: -3,
							max: 6,
							step: .1,
							unit: " dB",
							onChange: (makeupDb) => set({ glue: {
								...params.glue,
								makeupDb
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Optical",
							value: params.glue.optical,
							min: 0,
							max: 1,
							step: .01,
							unit: "",
							onChange: (optical) => set({ glue: {
								...params.glue,
								optical,
								enabled: true
							} })
						})
					]
				}),
				moduleId === "transient" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid gap-4 sm:grid-cols-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
							on: params.transient.enabled,
							label: params.transient.enabled ? "Shaper on" : "Shaper off",
							onClick: () => set({ transient: {
								...params.transient,
								enabled: !params.transient.enabled
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Attack",
							value: params.transient.attack,
							min: -1,
							max: 1,
							step: .01,
							unit: "",
							onChange: (attack) => set({ transient: {
								...params.transient,
								attack,
								enabled: true
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Sustain",
							value: params.transient.sustain,
							min: -1,
							max: 1,
							step: .01,
							unit: "",
							onChange: (sustain) => set({ transient: {
								...params.transient,
								sustain,
								enabled: true
							} })
						})
					]
				}),
				moduleId === "saturation" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid gap-4 sm:grid-cols-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
							on: params.saturation.enabled,
							label: params.saturation.enabled ? "Saturation on" : "Saturation off",
							onClick: () => set({ saturation: {
								...params.saturation,
								enabled: !params.saturation.enabled
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap gap-2 sm:col-span-2",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
									on: params.saturation.mode === "tape",
									label: "Tape",
									onClick: () => set({ saturation: {
										...params.saturation,
										mode: "tape",
										enabled: true
									} })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
									on: params.saturation.mode === "tube",
									label: "Tube",
									onClick: () => set({ saturation: {
										...params.saturation,
										mode: "tube",
										enabled: true
									} })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
									on: params.saturation.mode === "hybrid",
									label: "Hybrid",
									onClick: () => set({ saturation: {
										...params.saturation,
										mode: "hybrid",
										enabled: true
									} })
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Drive",
							value: params.saturation.driveDb,
							min: 0,
							max: 24,
							step: .1,
							unit: " dB",
							onChange: (driveDb) => set({ saturation: {
								...params.saturation,
								driveDb,
								enabled: true
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Mix",
							value: params.saturation.mix,
							min: 0,
							max: 1,
							step: .01,
							unit: "",
							onChange: (mix) => set({ saturation: {
								...params.saturation,
								mix,
								enabled: true
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Memory",
							value: params.saturation.memory,
							min: 0,
							max: 1,
							step: .01,
							unit: "",
							onChange: (memory) => set({ saturation: {
								...params.saturation,
								memory,
								enabled: true
							} })
						}),
						params.saturation.mode === "hybrid" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Tape amount",
							value: params.saturation.tubeTapeMix,
							min: 0,
							max: 1,
							step: .01,
							unit: "",
							onChange: (tubeTapeMix) => set({ saturation: {
								...params.saturation,
								tubeTapeMix,
								enabled: true
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Low color",
							value: params.saturation.lowColor,
							min: -1,
							max: 1,
							step: .01,
							unit: "",
							onChange: (lowColor) => set({ saturation: {
								...params.saturation,
								lowColor,
								enabled: true
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "High color",
							value: params.saturation.highColor,
							min: -1,
							max: 1,
							step: .01,
							unit: "",
							onChange: (highColor) => set({ saturation: {
								...params.saturation,
								highColor,
								enabled: true
							} })
						})
					]
				}),
				moduleId === "image" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid gap-4 sm:grid-cols-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Side width",
							value: params.width,
							min: 0,
							max: 2,
							step: .01,
							unit: "×",
							onChange: (width) => set({ width })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Center carve",
							value: params.carve,
							min: 0,
							max: 1,
							step: .01,
							unit: "",
							onChange: (carve) => set({ carve })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Carve focus",
							value: params.carveHz,
							min: 800,
							max: 8e3,
							step: 10,
							unit: " Hz",
							onChange: (carveHz) => set({ carveHz })
						})
					]
				}),
				moduleId === "limiter" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid gap-4 sm:grid-cols-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
							on: params.limiter.enabled,
							label: params.limiter.enabled ? "Limiter on" : "Limiter off",
							onClick: () => set({ limiter: {
								...params.limiter,
								enabled: !params.limiter.enabled
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Ceiling",
							value: params.limiter.ceilingDb,
							min: -3,
							max: -.1,
							step: .1,
							unit: " dBTP",
							onChange: (ceilingDb) => set({ limiter: {
								...params.limiter,
								ceilingDb,
								enabled: true
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Release",
							value: params.limiter.releaseMs,
							min: 10,
							max: 300,
							step: 1,
							unit: " ms",
							onChange: (releaseMs) => set({ limiter: {
								...params.limiter,
								releaseMs
							} })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Lookahead",
							value: params.limiter.lookaheadMs,
							min: 1,
							max: 10,
							step: .5,
							unit: " ms",
							onChange: (lookaheadMs) => set({ limiter: {
								...params.limiter,
								lookaheadMs
							} })
						})
					]
				})
			]
		})]
	});
}
function DynCut({ enabled, freq, q, threshold, maxCut, onToggle, onFreq, onQ, onThreshold, onCut }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "grid gap-4 sm:grid-cols-2",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
				on: enabled,
				label: enabled ? "Engaged" : "Bypassed",
				onClick: onToggle
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
				label: "Frequency",
				value: freq,
				min: 80,
				max: 16e3,
				step: 10,
				unit: " Hz",
				onChange: onFreq
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
				label: "Q",
				value: q,
				min: .4,
				max: 6,
				step: .1,
				unit: "",
				onChange: onQ
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
				label: "Threshold",
				value: threshold,
				min: -48,
				max: 0,
				step: .5,
				unit: " dB",
				onChange: onThreshold
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
				label: "Max cut",
				value: maxCut,
				min: 0,
				max: 12,
				step: .1,
				unit: " dB",
				onChange: onCut
			})
		]
	});
}
function EqControls({ params, curve, onChange }) {
	const update = (id, patch) => {
		onChange({
			...params,
			bands: params.bands.map((band) => band.id === id ? {
				...band,
				...patch
			} : band)
		});
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(EqCurve, { points: curve }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
						on: params.eqMode === "minimum",
						label: "Minimum phase",
						onClick: () => onChange({
							...params,
							eqMode: "minimum"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
						on: params.eqMode === "linear",
						label: "Linear phase",
						onClick: () => onChange({
							...params,
							eqMode: "linear"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
						on: params.eqTarget === "stereo",
						label: "Stereo",
						onClick: () => onChange({
							...params,
							eqTarget: "stereo"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
						on: params.eqTarget === "mid",
						label: "Mid",
						onClick: () => onChange({
							...params,
							eqTarget: "mid"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
						on: params.eqTarget === "side",
						label: "Side",
						onClick: () => onChange({
							...params,
							eqTarget: "side"
						})
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-col gap-4",
				children: params.bands.map((band) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid gap-3 border-t border-line pt-3 sm:grid-cols-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
							on: band.enabled && (bandIsActive(band) || band.type === "highpass"),
							label: bandLabel(band),
							onClick: () => update(band.id, { enabled: !band.enabled })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Freq",
							value: band.freq,
							min: 20,
							max: 18e3,
							step: 1,
							unit: " Hz",
							onChange: (freq) => update(band.id, {
								freq,
								enabled: true
							})
						}),
						band.type !== "highpass" && band.type !== "lowpass" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Gain",
							value: band.gainDb,
							min: -12,
							max: 12,
							step: .1,
							unit: " dB",
							onChange: (gainDb) => update(band.id, {
								gainDb,
								enabled: true
							})
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "self-end pb-3 text-xs text-faint",
							children: "Slope follows Q"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
							label: "Q",
							value: band.q,
							min: .3,
							max: 8,
							step: .1,
							unit: "",
							onChange: (q) => update(band.id, { q })
						})
					]
				}, band.id))
			})
		]
	});
}
function bandLabel(band) {
	if (band.type === "highpass") return band.enabled ? "High-pass on" : "High-pass";
	if (band.type === "lowshelf") return "Low shelf";
	if (band.type === "highshelf") return "High shelf";
	if (band.id === "mud") return "Body";
	if (band.id === "presence") return "Presence";
	return band.type;
}
function Multiband({ params, onChange }) {
	const mb = params.multiband;
	const setBand = (key, thresholdDb, ratio) => {
		onChange({
			...params,
			multiband: {
				...mb,
				enabled: true,
				[key]: {
					...mb[key],
					thresholdDb,
					ratio
				}
			}
		});
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-wrap gap-2",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, {
					on: mb.enabled,
					label: mb.enabled ? "Multiband on" : "Multiband off",
					onClick: () => onChange({
						...params,
						multiband: {
							...mb,
							enabled: !mb.enabled
						}
					})
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 sm:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
					label: "Low crossover",
					value: mb.lowHz,
					min: 60,
					max: 400,
					step: 1,
					unit: " Hz",
					onChange: (lowHz) => onChange({
						...params,
						multiband: {
							...mb,
							lowHz: Math.min(lowHz, mb.highHz - 50)
						}
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
					label: "High crossover",
					value: mb.highHz,
					min: 1e3,
					max: 12e3,
					step: 10,
					unit: " Hz",
					onChange: (highHz) => onChange({
						...params,
						multiband: {
							...mb,
							highHz: Math.max(highHz, mb.lowHz + 50)
						}
					})
				})]
			}),
			[
				"low",
				"mid",
				"high"
			].map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3 border-t border-line pt-3 sm:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
					label: `${key} threshold`,
					value: mb[key].thresholdDb,
					min: -40,
					max: 0,
					step: .5,
					unit: " dB",
					onChange: (thresholdDb) => setBand(key, thresholdDb, mb[key].ratio)
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Knob, {
					label: `${key} ratio`,
					value: mb[key].ratio,
					min: 1,
					max: 6,
					step: .1,
					unit: ":1",
					onChange: (ratio) => setBand(key, mb[key].thresholdDb, ratio)
				})]
			}, key))
		]
	});
}
function Map() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-2",
		children: [[
			[
				"1",
				"Input gain",
				"Live"
			],
			[
				"2",
				"EQ, minimum or linear phase, mid/side",
				"Live"
			],
			[
				"3",
				"Dynamic EQ",
				"Live"
			],
			[
				"4",
				"Split-band de-esser",
				"Live"
			],
			[
				"5",
				"3-band linear-phase Linkwitz–Riley",
				"Live"
			],
			[
				"6",
				"Serial VCA + optical glue",
				"Live"
			],
			[
				"7",
				"Transient shaper",
				"Live"
			],
			[
				"8",
				"8× hybrid tape / tube saturation",
				"Live"
			],
			[
				"9",
				"Width and center-side carve",
				"Live"
			],
			[
				"10",
				"True-peak lookahead limiter",
				"Live"
			],
			[
				"11",
				"TPDF dither on 16/24-bit export",
				"Live"
			],
			[
				"—",
				"Source separation, convolution, automatic master",
				"Not in this phase"
			]
		].map(([n, name, state]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid grid-cols-[2rem_1fr_auto] items-baseline gap-3 border-b border-line py-2 text-sm",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-xs text-amber",
					children: n
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: name }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: `font-mono text-xs ${state === "Live" ? "text-muted" : "text-faint"}`,
					children: state
				})
			]
		}, name)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "pt-2 text-sm text-pretty text-muted",
			children: "Internal math is 64-bit. Export is 32-bit float, or dithered 24- or 16-bit. The audible engine is this chain. A C++ node checks the cookbook biquad and a unity-gain tanh. Browser saturation is the 8× hybrid model, not that tanh. Nothing here is a plugin host."
		})]
	});
}
var MODULES = [
	{
		id: "map",
		name: "Signal chain"
	},
	{
		id: "input",
		name: "Input"
	},
	{
		id: "eq",
		name: "Equalizer"
	},
	{
		id: "dynamic",
		name: "Dynamic EQ"
	},
	{
		id: "deess",
		name: "De-esser"
	},
	{
		id: "multiband",
		name: "Multiband"
	},
	{
		id: "glue",
		name: "Glue"
	},
	{
		id: "transient",
		name: "Transients"
	},
	{
		id: "saturation",
		name: "Saturation"
	},
	{
		id: "image",
		name: "Stereo"
	},
	{
		id: "limiter",
		name: "Limiter"
	}
];
function toF32(x) {
	const y = new Float32Array(/* @__PURE__ */ new ArrayBuffer(x.length * 4));
	for (let i = 0; i < x.length; i++) y[i] = x[i] ?? 0;
	return y;
}
var MAX_SECONDS = 720;
async function decodeWithBrowser(bytes) {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	const audio = await new OfflineAudioContext(2, 64, 48e3).decodeAudioData(copy);
	return {
		l: Float64Array.from(audio.getChannelData(0)),
		r: Float64Array.from(audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)),
		sampleRate: audio.sampleRate
	};
}
async function decodeFile(file) {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const wav = decodeWavPcm(bytes);
	if (wav) return wav;
	try {
		return await decodeWithBrowser(bytes);
	} catch {
		throw new Error("This browser could not decode that file. Export a 16-bit, 24-bit, or 32-bit WAV and load that.");
	}
}
function Studio() {
	const session = useSession();
	const [playing, setPlaying] = (0, import_react.useState)(false);
	const [progress, setProgress] = (0, import_react.useState)(0);
	const ctxRef = (0, import_react.useRef)(null);
	const sourceRef = (0, import_react.useRef)(null);
	const rafRef = (0, import_react.useRef)(0);
	const startedRef = (0, import_react.useRef)(0);
	(0, import_react.useEffect)(() => {
		session.loadDemo();
		return () => {
			sourceRef.current?.stop();
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
		};
	}, []);
	const stop = () => {
		sourceRef.current?.stop();
		sourceRef.current = null;
		if (rafRef.current) cancelAnimationFrame(rafRef.current);
		setPlaying(false);
	};
	const play = async () => {
		const program = session.program;
		if (!program) return;
		let audio = program;
		if (session.source === "processed" && session.rendered) audio = session.rendered;
		if (session.source === "reference") audio = session.reference;
		if (!audio) return;
		stop();
		try {
			const ctx = ctxRef.current && ctxRef.current.sampleRate === audio.sampleRate ? ctxRef.current : new AudioContext({ sampleRate: audio.sampleRate });
			if (ctxRef.current && ctxRef.current !== ctx) ctxRef.current.close();
			ctxRef.current = ctx;
			if (ctx.state === "suspended") await ctx.resume();
			let l = audio.l;
			let r = audio.r;
			if (session.monitor === "mono") {
				const folded = foldMono(l, r);
				l = folded.l;
				r = folded.r;
			}
			const buffer = ctx.createBuffer(2, l.length, audio.sampleRate);
			buffer.copyToChannel(toF32(l), 0);
			buffer.copyToChannel(toF32(r), 1);
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			const gain = ctx.createGain();
			const match = playbackGainDb(session);
			gain.gain.value = Math.pow(10, match / 20);
			source.connect(gain);
			if (session.monitor === "small") {
				const hp = ctx.createBiquadFilter();
				hp.type = "highpass";
				hp.frequency.value = 180;
				hp.Q.value = .7;
				const lp = ctx.createBiquadFilter();
				lp.type = "lowpass";
				lp.frequency.value = 5500;
				lp.Q.value = .7;
				gain.connect(hp);
				hp.connect(lp);
				lp.connect(ctx.destination);
			} else gain.connect(ctx.destination);
			source.onended = () => {
				setPlaying(false);
				setProgress(0);
			};
			source.start();
			sourceRef.current = source;
			startedRef.current = ctx.currentTime;
			setPlaying(true);
			const duration = buffer.duration;
			const tick = () => {
				const elapsed = (ctx.currentTime - startedRef.current) / duration;
				setProgress(Math.max(0, Math.min(1, elapsed)));
				if (elapsed < 1) rafRef.current = requestAnimationFrame(tick);
			};
			rafRef.current = requestAnimationFrame(tick);
		} catch (error) {
			setPlaying(false);
			useSession.setState({ error: error instanceof Error ? error.message : "Playback failed" });
		}
	};
	const playingRef = (0, import_react.useRef)(false);
	playingRef.current = playing;
	const playRef = (0, import_react.useRef)(play);
	const stopRef = (0, import_react.useRef)(stop);
	playRef.current = play;
	stopRef.current = stop;
	(0, import_react.useEffect)(() => {
		const onKey = (event) => {
			if (event.code !== "Space" || event.target !== document.body) return;
			event.preventDefault();
			if (playingRef.current) stopRef.current();
			else playRef.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	const balance = balanceOf(session);
	const match = playbackGainDb(session);
	const rate = session.program?.sampleRate ?? 48e3;
	const presetList = presets();
	const primeAudio = () => {
		const ctx = ctxRef.current ?? new AudioContext();
		ctxRef.current = ctx;
		if (ctx.state === "suspended") ctx.resume();
		return ctx;
	};
	const takeFile = async (file, kind) => {
		if (!file) return;
		useSession.setState({
			busy: `Reading ${file.name}`,
			error: null
		});
		try {
			const audio = await decodeFile(file);
			if (audio.l.length < 8) throw new Error("That file has no audio samples.");
			if (audio.l.length / audio.sampleRate > MAX_SECONDS) throw new Error("That file is longer than 12 minutes. Bounce a shorter version and load that.");
			if (kind === "program") session.loadProgram(file.name, audio);
			else session.loadReference(file.name, audio);
		} catch (error) {
			useSession.setState({
				busy: null,
				error: error instanceof Error ? error.message : "That file could not be decoded. Export a WAV and try again."
			});
		}
	};
	const onFileChange = (event, kind) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		takeFile(file, kind);
	};
	const onDrop = (event) => {
		event.preventDefault();
		primeAudio();
		const file = event.dataTransfer.files?.[0];
		takeFile(file, "program");
	};
	const exportWav = (bits) => {
		const rendered = session.rendered;
		if (!rendered) return;
		const bytes = encodeWav([bits === 32 ? rendered.l : quantizeWithDither(rendered.l, bits), bits === 32 ? rendered.r : quantizeWithDither(rendered.r, bits)], rendered.sampleRate, bits);
		const copy = new ArrayBuffer(bytes.byteLength);
		new Uint8Array(copy).set(bytes);
		const blob = new Blob([copy], { type: "audio/wav" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = bits === 32 ? "aurora-master-32f.wav" : `aurora-master-${bits}.wav`;
		link.click();
		URL.revokeObjectURL(url);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex h-dvh flex-col bg-bg text-fg",
		onDragOver: (event) => event.preventDefault(),
		onDrop,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", {
				className: "shrink-0 border-b border-line",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-3 px-4 py-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-mono text-xs tracking-widest text-amber",
						children: "AURORA"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "text-2xl font-medium text-balance",
						children: "Mastering console"
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "max-w-md text-sm text-pretty text-muted",
						children: "Phase 1 measures the file, then runs a reversible chain. Louder is not treated as better."
					})]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
				className: "mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-center gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "h-11 rounded-md bg-surface px-3 text-sm",
								onClick: () => session.loadDemo(),
								children: "House program"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "h-11 rounded-md bg-surface px-3 text-sm",
								onClick: () => session.loadCalibration(),
								children: "−23 LUFS tone"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-surface px-3 text-sm",
								onPointerDown: () => primeAudio(),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Upload, {
										className: "size-4",
										"aria-hidden": "true"
									}),
									"Program",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										className: "sr-only",
										type: "file",
										accept: "audio/*,.wav,.wave,.aif,.aiff,.mp3,.flac,.ogg,.m4a,.aac,.caf",
										onChange: (event) => onFileChange(event, "program")
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-surface px-3 text-sm",
								onPointerDown: () => primeAudio(),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Upload, {
										className: "size-4",
										"aria-hidden": "true"
									}),
									"Reference",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										className: "sr-only",
										type: "file",
										accept: "audio/*,.wav,.wave,.aif,.aiff,.mp3,.flac,.ogg,.m4a,.aac,.caf",
										onChange: (event) => onFileChange(event, "reference")
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "font-mono text-xs text-muted",
								children: [
									session.programName || "No program",
									session.referenceName ? ` · ref ${session.referenceName}` : "",
									session.program ? ` · ${(rate / 1e3).toFixed(1)} kHz` : ""
								]
							}),
							session.busy && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-xs text-amber",
								children: session.busy
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-xs text-muted",
								children: "WAV, MP3, FLAC, or AIFF. Drop a file anywhere on the console."
							})
						]
					}),
					session.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "rounded-md border border-clip px-3 py-2 text-sm text-clip",
						role: "alert",
						children: session.error
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_20rem]",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
								className: "flex gap-2 overflow-x-auto lg:flex-col",
								"aria-label": "Signal chain",
								children: MODULES.map((mod, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									onClick: () => session.setModule(mod.id),
									className: `h-11 shrink-0 rounded-md px-3 text-left text-sm lg:w-full ${session.moduleId === mod.id ? "bg-amber text-ink" : "bg-surface text-fg"}`,
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "mr-2 font-mono text-xs opacity-70",
										children: String(index).padStart(2, "0")
									}), mod.name]
								}, mod.id))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
								className: "flex min-w-0 flex-col gap-3",
								"aria-label": "Analysis",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "rounded-lg border border-line bg-surface p-3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "mb-2 flex items-baseline justify-between gap-3",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
												className: "text-sm font-medium",
												children: "Spectrum"
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "font-mono text-xs text-muted",
												children: "Amber program · bone reference"
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpectrumPlot, {
											analysis: session.analysis,
											reference: session.refAnalysis
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "mt-3",
											children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Waveform, {
												left: session.source === "processed" ? session.rendered?.l ?? session.program?.l ?? null : session.source === "reference" ? session.reference?.l ?? null : session.program?.l ?? null,
												progress: playing ? progress : 0
											})
										})
									]
								}), balance.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "rounded-lg border border-line bg-surface p-3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
											className: "text-sm font-medium",
											children: "Tonal balance against the reference"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
											className: "mt-1 text-xs text-pretty text-muted",
											children: "Each third-octave is centered on its own average, so a louder file does not look brighter. Positive means the program has more energy there than the reference."
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "mt-3 flex flex-col gap-1",
											children: balance.filter((_, i) => i % 2 === 0).map((band) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BalanceRow, {
												freq: band.freq,
												delta: band.deltaDb
											}, band.freq))
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meters, {
								analysis: session.analysis,
								report: session.report,
								targetLufs: session.targetLufs,
								onTarget: session.setTarget
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap gap-2",
						children: [presetList.map((preset) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							title: preset.detail,
							onClick: () => session.setParams(preset.params),
							className: "h-11 rounded-md bg-surface px-3 text-sm",
							children: preset.name
						}, preset.id)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "h-11 rounded-md bg-surface px-3 text-sm",
							onClick: () => session.setParams(neutralParams()),
							children: "Reset"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModulePanel, {
						moduleId: session.moduleId,
						params: session.params,
						sampleRate: rate,
						onChange: session.setParams
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "rounded-lg border border-line bg-surface p-4",
						"aria-label": "Findings",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "text-sm font-medium",
								children: "What the measurements support"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 text-sm text-pretty text-muted",
								children: "Nothing here is applied until you audition it. A resonance can be the instrument. Compare at matched loudness."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
								className: "mt-4 flex flex-col gap-4",
								children: [session.findings.map((finding) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "border-t border-line pt-3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "flex flex-wrap items-baseline justify-between gap-2",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
												className: "text-base font-medium",
												children: finding.title
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												className: "font-mono text-xs text-muted",
												children: [finding.confidence, " confidence"]
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
											className: "mt-1 text-sm text-pretty text-muted",
											children: finding.evidence
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
											className: "mt-1 text-sm text-pretty",
											children: finding.action
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
											className: "mt-1 text-xs text-pretty text-faint",
											children: ["Tradeoff: ", finding.sideEffect]
										}),
										finding.patch && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: "mt-2 h-11 rounded-md bg-amber px-3 text-sm text-ink",
											onClick: () => session.patchParams(finding.patch ?? {}),
											children: "Audition this"
										})
									]
								}, finding.id)), session.findings.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
									className: "text-sm text-muted",
									children: "Measurements appear once the program is in."
								})]
							})
						]
					}),
					session.report && session.report.notes.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "flex flex-col gap-1 text-xs text-pretty text-muted",
						children: session.report.notes.map((note) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: note }, note))
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "shrink-0 border-t border-line bg-surface px-4 py-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mx-auto flex max-w-7xl flex-wrap items-center gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => playing ? stop() : void play(),
								disabled: !session.program,
								className: "inline-flex h-11 items-center gap-2 rounded-md bg-amber px-4 text-sm font-medium text-ink disabled:opacity-40",
								children: [playing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, { className: "size-4" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, { className: "size-4" }), playing ? "Stop" : "Play"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Choice, {
								value: session.source,
								options: [
									["original", "Original"],
									["processed", "Processed"],
									["reference", "Reference"]
								],
								onChange: (value) => session.setSource(value)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Choice, {
								value: session.monitor,
								options: [
									["full", "Full range"],
									["mono", "Mono"],
									["small", "Small speaker"]
								],
								onChange: (value) => session.setMonitor(value)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								"aria-pressed": session.matchLoudness,
								onClick: () => session.setMatch(!session.matchLoudness),
								className: `h-11 rounded-md px-3 text-sm ${session.matchLoudness ? "bg-amber text-ink" : "bg-bg text-fg"}`,
								children: ["Match loudness", session.matchLoudness && Math.abs(match) >= .05 ? ` ${match > 0 ? "+" : ""}${match.toFixed(1)} dB` : ""]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "inline-flex h-11 items-center gap-2 rounded-md bg-bg px-3 text-sm disabled:opacity-40",
								disabled: !session.rendered,
								onClick: () => exportWav(24),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, {
									className: "size-4",
									"aria-hidden": "true"
								}), "24-bit WAV"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "h-11 rounded-md bg-bg px-3 text-sm disabled:opacity-40",
								disabled: !session.rendered,
								onClick: () => exportWav(32),
								children: "32-float"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "h-11 rounded-md bg-bg px-3 text-sm disabled:opacity-40",
								disabled: !session.rendered,
								onClick: () => exportWav(16),
								children: "16-bit"
							})
						]
					}),
					session.source === "processed" && session.program && !session.rendered && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mx-auto mt-2 max-w-7xl text-xs text-muted",
						children: "Play is the original until the master finishes rendering. Export stays off until then."
					}),
					session.monitor !== "full" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mx-auto mt-2 max-w-7xl text-xs text-muted",
						children: session.monitor === "mono" ? "Mono fold is monitoring only. The export stays stereo." : "Small-speaker mode is a 180 Hz high-pass and a 5.5 kHz low-pass. It is not a model of a particular speaker, and it is not printed into the export."
					})
				]
			})
		]
	});
}
function Choice({ value, options, onChange }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "flex rounded-md bg-bg p-1",
		children: options.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			"aria-pressed": value === id,
			onClick: () => onChange(id),
			className: `h-11 rounded px-3 text-sm ${value === id ? "bg-amber text-ink" : "text-fg"}`,
			children: label
		}, id))
	});
}
function BalanceRow({ freq, delta }) {
	const clamped = Math.max(-9, Math.min(9, delta));
	const width = Math.abs(clamped) / 9 * 50;
	const label = freq >= 1e3 ? `${(freq / 1e3).toFixed(freq >= 1e4 ? 0 : 1)}k` : `${Math.round(freq)}`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "grid grid-cols-[3rem_1fr_3.5rem] items-center gap-2",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "font-mono text-xs text-muted",
				children: label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "relative h-2 rounded-full bg-bg",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute top-0 left-1/2 h-full w-px bg-line" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "absolute top-0 h-full bg-amber",
					style: {
						width: `${width}%`,
						left: clamped >= 0 ? "50%" : `${50 - width}%`
					}
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "text-right font-mono text-xs tabular-nums text-fg",
				children: [delta > 0 ? "+" : "", delta.toFixed(1)]
			})
		]
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Studio, {});
}
//#endregion
export { Home as component };
