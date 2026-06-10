// Daily Agent Digest — design system
// Deep navy command-center palette with sky-blue telemetry accents

const HSL = (h: number, s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`;

const palette = {
  // Core surfaces
  background: HSL(220, 30, 8),
  card: HSL(220, 30, 11),
  input: HSL(220, 30, 14),
  border: HSL(220, 15, 22),
  borderFocus: HSL(199, 89, 48),

  // Text
  textPrimary: HSL(220, 20, 92),
  textSecondary: HSL(215, 15, 55),
  textMuted: HSL(220, 10, 42),

  // Accent
  accent: HSL(199, 89, 48),
  accentGradient: [HSL(199, 89, 48), HSL(199, 89, 40)] as const,
  accentPressed: HSL(199, 89, 36),

  // Semantic
  success: HSL(142, 71, 45),
  warning: HSL(38, 92, 50),
  destructive: HSL(0, 84, 60),
  destructiveBg: HSL(0, 84, 14),

  // Agent accents
  agentBlue: HSL(217, 91, 60),
  agentPurple: HSL(271, 91, 65),
  agentTeal: HSL(173, 80, 40),
  agentOrange: HSL(25, 95, 53),
} as const;

// CSS string colors for inline styles / non-StyleSheet usage
export const Colors = {
  ...palette,
  accentGradientStart: palette.accentGradient[0],
  accentGradientEnd: palette.accentGradient[1],
  white: "#ffffff",
  black: "#000000",
  transparent: "transparent",
} as const;

export default palette;
