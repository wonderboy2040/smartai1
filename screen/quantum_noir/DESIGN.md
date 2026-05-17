---
name: Quantum Noir
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#849495'
  outline-variant: '#3a494b'
  surface-tint: '#00dbe7'
  primary: '#e1fdff'
  on-primary: '#00363a'
  primary-container: '#00f2ff'
  on-primary-container: '#006a71'
  inverse-primary: '#00696f'
  secondary: '#ebb2ff'
  on-secondary: '#520072'
  secondary-container: '#b600f8'
  on-secondary-container: '#fff6fc'
  tertiary: '#f6f7ff'
  on-tertiary: '#233148'
  tertiary-container: '#cddbf9'
  on-tertiary-container: '#526079'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#74f5ff'
  primary-fixed-dim: '#00dbe7'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#f8d8ff'
  secondary-fixed-dim: '#ebb2ff'
  on-secondary-fixed: '#320047'
  on-secondary-fixed-variant: '#74009f'
  tertiary-fixed: '#d6e3ff'
  tertiary-fixed-dim: '#b9c7e4'
  on-tertiary-fixed: '#0d1c32'
  on-tertiary-fixed-variant: '#39475f'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  h1:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  h2:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.1em
  mono-data:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 40px
  xl: 64px
  container-max: 1440px
  gutter: 24px
---

## Brand & Style

The brand personality of this design system is one of hyper-intelligence, elite exclusivity, and unwavering security. It is designed for high-net-worth individuals who demand the speed of silicon and the precision of quantum computing in their wealth management. The aesthetic is a sophisticated fusion of **Glassmorphism** and **High-Tech Futurism**, creating a digital environment that feels less like a website and more like a high-end command center.

Visually, the system relies on deep atmospheric depth, punctuated by vibrant, energy-infused accents that represent data flow and algorithmic activity. The emotional response should be one of calm confidence in the face of complex financial markets—where the user feels they have a "digital edge."

## Colors

This design system utilizes a strictly dark-mode palette to minimize eye strain and maximize the impact of data visualizations. The foundation is built on **Deep Black (#050505)** for true-black backgrounds, paired with **Dark Blue (#0a192f)** for container backgrounds and structural depth.

**Primary Cyan (#00f2ff)** is reserved for interactive elements, success states, and high-priority data points, symbolizing speed and intelligence. **Secondary Purple (#bc13fe)** is used for premium features, AI-driven insights, and sophisticated wealth-building indicators. Gradients should blend these two accents—moving from cyan to purple—to represent the transition from raw data to actionable wealth.

## Typography

The typography strategy balances technical precision with high-end editorial clarity. **Space Grotesk** is used for headlines and data readouts to lean into the futuristic, geometric aesthetic of quantum computing. Its open apertures ensure legibility even at high weights.

**Inter** serves as the primary workhorse for body copy and UI labels, providing a neutral, trustworthy foundation that doesn't compete with the vibrant color palette. Use the `mono-data` style specifically for financial figures and ticker symbols to evoke the feeling of a real-time trading terminal.

## Layout & Spacing

This design system employs a **12-column fixed grid** centered within a 1440px container for desktop views. The spacing rhythm is strictly based on an **8px linear scale**, ensuring mathematical harmony across all layouts. 

Layouts should prioritize high information density without feeling cluttered. Large 64px (xl) margins are used to separate major functional modules (e.g., Portfolio Overview vs. AI Recommendations), while tighter 24px (md) spacing is used within components to create a sense of interconnected "data clusters."

## Elevation & Depth

Hierarchy is established through **Glassmorphism** and light-refraction rather than traditional drop shadows. Surfaces are defined by three distinct layers:

1.  **Background Layer:** True black (#050505) for maximum contrast.
2.  **Surface Layer:** Semi-transparent dark blue (#0a192f) with a 15px backdrop blur.
3.  **Illumination Layer:** A 1px semi-transparent border (top and left sides only) using a white or cyan tint at 10% opacity to simulate a "rim light" hitting the edge of a glass pane.

For high-priority items, a subtle outer glow using the primary cyan color (#00f2ff) at a 5% opacity should be applied to suggest an active power state.

## Shapes

The shape language is defined by "Precision Geometry." All UI elements follow a **Soft (0.25rem)** rounding standard to maintain a serious, high-tech feel. This slight rounding prevents the interface from feeling "hostile" or "brutalist" while remaining much sharper and more professional than consumer-grade apps.

Interactive containers should utilize 0.5rem (rounded-lg) for better visual framing. Circular shapes are reserved exclusively for avatars and status indicators to denote "organic" or "live" elements within the geometric grid.

## Components

### Buttons
Primary buttons should feature a solid gradient fill (Cyan to Purple) with white text for maximum legibility. Secondary buttons must use a "ghost" style: a transparent background with a 1px Cyan border and a subtle hover glow. All buttons should have a `letter-spacing` of 0.05em to enhance the premium feel.

### Cards & Modules
All cards must implement the Glassmorphism style: backdrop-blur (12px), semi-transparent background, and a subtle top-left highlight border. Content within cards should have a minimum of 24px internal padding.

### Data Inputs
Inputs are minimalist—bottom-border only (#0a192f). On focus, the border transitions to Primary Cyan with a soft neon under-glow. Placeholders should be set in Inter at 40% opacity.

### Charts & Visualizations
Line charts should use a neon-glow effect (SVG filters) for the path. Use Cyan for "Growth" and Purple for "Projected Intelligence." Grid lines should be barely visible at 5% opacity to allow the data to "float" in space.

### AI Intelligence Chip
A custom component for this design system: a small, pill-shaped badge with a rotating gradient border. This chip indicates where AI has performed an action or provided a recommendation, acting as a "seal of intelligence."