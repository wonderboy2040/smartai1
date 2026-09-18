# Wealth AI — Neumorphism Redesign

The complete **Wealth AI Pro Trading Terminal** has been restyled from its
original dark "Quantum Pro" glassmorphism theme into a clean, tactile
**Neumorphism (Soft UI)** design — fully responsive on mobile and desktop.

---

## ✨ What changed

| Area              | Before                              | After                                  |
|-------------------|-------------------------------------|----------------------------------------|
| Color system      | Dark slate + neon cyan/purple       | Soft neumorphic grey `#e6ebf2` + indigo accent |
| Surfaces          | Glassmorphism with blur + glow      | Soft extruded plastic with dual shadows |
| Buttons           | Gradient + neon glow                | Solid raised neumorphic + inset on press |
| Inputs            | Dark glass with cyan glow           | Inset shadows, soft recessed wells    |
| Tabs              | Animated underline + glow           | Inset tray with raised active state   |
| Cards             | Translucent + border glow           | Soft raised shadows with hover lift   |
| Login screen      | Dark gradient + glow                | Calm neumorphic card on light bg      |
| Dark mode         | Neon noir                           | Dark neumorphic (`#2a2e38`) variant   |
| Mobile            | Same as desktop                     | Flatter shadows, tighter radii, larger tap targets |

---

## 🎨 Design tokens

All neumorphic styling is driven by CSS variables in `src/index.css` under
`:root` (and `.dark` for dark neumorphism). The key ones:

```css
--neu-bg: #e6ebf2;            /* app background */
--neu-surface: #e6ebf2;       /* card surfaces (same as bg for extruded look) */
--neu-light: #ffffff;         /* top-left highlight shadow */
--neu-dark: #b8c2d2;          /* bottom-right recessed shadow */
--neu-accent: #6366f1;        /* indigo accent for active/primary states */
--neu-success: #10b981;       /* emerald for buy/profit */
--neu-danger: #ef4444;        /* red for sell/loss */
--neu-warning: #f59e0b;       /* amber for hold/warning */

--neu-shadow:      6px 6px 13px rgba(184,194,210,.55), -6px -6px 13px rgba(255,255,255,.95);
--neu-shadow-sm:   4px 4px 9px  rgba(184,194,210,.55), -4px -4px 9px  rgba(255,255,255,.95);
--neu-shadow-lg:   9px 9px 20px rgba(184,194,210,.55), -9px -9px 20px rgba(255,255,255,.95);
--neu-shadow-inset: inset 4px 4px 9px rgba(184,194,210,.55), inset -4px -4px 9px rgba(255,255,255,.95);
```

To re-skin the entire app, change `--neu-bg`, `--neu-light`, and `--neu-dark`
— every component will pick up the new palette automatically.

---

## 📱 Responsive behaviour

- **≥ 1024 px** (desktop) — full `--neu-shadow` depth, comfortable spacing
- **640–1024 px** (tablet) — shadow depth slightly reduced for clarity
- **< 640 px** (mobile) — flatter shadows (4 px), tighter radii (12–14 px),
  bigger tap targets (40 px min), `padding` reduced on panels
- **< 380 px** (small phones) — radii drop to 12 px, panel padding 12 px
- **Touch devices** (`@media hover: none`) — hover lift animations disabled
  so cards don't "stick" when tapped

The header tab bar collapses to emoji-only on mobile via Tailwind's
`hidden sm:inline` / `sm:hidden` pattern (preserved from the original).

---

## 🛠️ How it works (no component rewrites needed)

The neumorphism system in `src/index.css` does three things:

1. **Remaps the Tailwind slate palette** via `@theme` so existing
   `bg-slate-950`, `text-slate-400` etc. utilities automatically render
   in the neumorphic light palette. The dark slate-950 background becomes
   the light neumorphic background, light slate-400 text becomes darker
   neumorphic text — perfect inversion.

2. **Overrides dark utilities** like `bg-black/30`, `bg-white/5`,
   `border-white/5`, and `bg-gradient-to-*` to neumorphic equivalents,
   so the existing Tailwind classes inside components still produce the
   right look.

3. **Redefines every `quantum-*` and `glass-*` class** with neumorphic
   shadows. Since the original components all reference these classes,
   the entire UI flips to neumorphism without touching the component code.

This means: **zero component rewrites, zero functionality changes,
zero new dependencies** — only `src/index.css`, `src/App.tsx` (minimal
tweaks for the login screen and main wrapper), and `index.html` (body
background + theme-color) were modified.

---

## 🚀 Run it

```bash
# 1. Install dependencies
npm install

# 2. Dev server (http://localhost:5173)
npm run dev

# 3. Production build
npm run build

# 4. Preview the build (http://localhost:4173)
npm run preview
```

The default PIN is `2023` (set in `src/hooks/useAppState.ts`).

---

## 📁 Project structure (unchanged)

```
smartai1/
├── src/
│   ├── index.css           ← REWRITTEN — Neumorphism design system
│   ├── App.tsx             ← minor tweaks (login screen + main wrapper)
│   ├── components/         ← untouched, all use quantum-* classes
│   ├── hooks/              ← untouched
│   └── utils/              ← untouched
├── index.html              ← body bg + theme-color updated
├── package.json
├── vite.config.ts
└── ... (server, ml-service, telegram-bot untouched)
```

All existing functionality — real-time market feeds, AI chat, portfolio
tracking, signals, ML engine, Telegram bot — works exactly as before.
Only the visual layer has changed.

---

## 🎯 Design principles followed

1. **Soft, calm, tactile** — no neon, no aggressive gradients, no glow.
2. **Dual-shadow extrusion** — every raised element has light from
   top-left + dark from bottom-right.
3. **Inset on press** — buttons "press in" instead of changing color.
4. **Monochromatic with accent** — the surface palette stays neutral;
   accent colors only for state (buy/sell/active).
5. **Generous radii** — 18 px default, 24 px for modals, pill for badges.
6. **Responsive depth** — shadows flatten on smaller screens to save space
   and improve rendering performance.
7. **Accessibility** — text contrast preserved at WCAG AA, tap targets
   ≥ 40 px on mobile, focus states retained via inset shadows.
