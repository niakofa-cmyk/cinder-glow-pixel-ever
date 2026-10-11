// Aurora Phase-1 DSP node.
// Standard C++17 so it builds without a JUCE checkout. The process() shape is
// what a juce::AudioProcessor::processBlock would call. Same biquad cookbook
// and unity-gain tanh as the browser engine.
#include <cmath>
#include <cstdint>
#include <iostream>
#include <vector>

struct Biquad {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  double s1 = 0, s2 = 0;
  void reset() { s1 = s2 = 0; }
  float process(float x) {
    const double y = b0 * x + s1;
    s1 = b1 * x - a1 * y + s2;
    s2 = b2 * x - a2 * y;
    return static_cast<float>(y);
  }
};

Biquad peaking(double freq, double q, double gainDb, double sampleRate) {
  const double A = std::pow(10.0, gainDb / 40.0);
  const double w0 = 2.0 * M_PI * freq / sampleRate;
  const double cosw = std::cos(w0);
  const double alpha = std::sin(w0) / (2.0 * q);
  const double b0 = 1.0 + alpha * A;
  const double b1 = -2.0 * cosw;
  const double b2 = 1.0 - alpha * A;
  const double a0 = 1.0 + alpha / A;
  const double a1 = -2.0 * cosw;
  const double a2 = 1.0 - alpha / A;
  return Biquad{b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0, 0, 0};
}

// Tape-style symmetric waveshaper. Unity small-signal gain. Not a tape model.
inline float tape(float x, float drive) {
  const float g = drive < 0.01f ? 0.01f : drive;
  return std::tanh(g * x) / g;
}

int main() {
  const double sr = 48000.0;
  Biquad eq = peaking(1000.0, 1.0, 6.0, sr);
  double inEnergy = 0;
  double outEnergy = 0;
  const int n = 24000;
  for (int i = 0; i < n; ++i) {
    const float x = static_cast<float>(0.1 * std::sin(2.0 * M_PI * 1000.0 * i / sr));
    const float y = eq.process(x);
    if (i > 8000) {
      inEnergy += static_cast<double>(x) * x;
      outEnergy += static_cast<double>(y) * y;
    }
  }
  const double db = 20.0 * std::log10(std::sqrt(outEnergy / inEnergy));
  if (std::abs(db - 6.0) > 0.3) {
    std::cerr << "peaking gain " << db << " dB\n";
    return 1;
  }

  // A full-scale sample must not grow through the unity-gain waveshaper at 0 dB drive.
  const float unity = tape(0.5f, 1.0f);
  if (std::abs(unity - std::tanh(0.5f)) > 1e-5f) {
    std::cerr << "tape unity " << unity << "\n";
    return 1;
  }
  // Harder drive compresses the peak toward 0.
  if (!(tape(1.0f, 8.0f) < 0.5f)) {
    std::cerr << "tape drive did not compress\n";
    return 1;
  }

  std::cout << "aurora node ok " << db << " dB\n";
  return 0;
}
