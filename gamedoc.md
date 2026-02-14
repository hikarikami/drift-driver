# Neon Drift (Working Title)

## One-Sentence Pitch

An isometric arcade stunt-driving game where players drift, chain tricks, and collect the ball to build massive combo scores.

---

# Core Concept

Neon Drift is an isometric trick-driving game focused on:

- Stylized arcade drifting
- Risk-based trick scoring
- Combo chains
- Momentum and flow
- Collecting a roaming “ball” to sustain score

The goal is not racing — it’s **style, control, and risk**.

---

# Core Loop

1. Player drives the car in an isometric arena.
2. Player performs drifts, near-misses, jumps, and risky maneuvers.
3. Player collects the roaming “ball”.
4. Tricks build combo multiplier.
5. Dropping combo loses bonus score.
6. Speed and difficulty escalate over time.

---

# Camera & Perspective

- Isometric camera (fixed angle).
- Top-down isometric projection (2.5D feel).
- Arena-based gameplay (no scrolling world initially).

---

# Core Mechanics

## Driving Model

- Physics-inspired arcade handling.
- Acceleration / braking.
- Steering rotates car.
- Drift mechanic:
  - Reduced grip.
  - Momentum sliding.
  - Controlled oversteer.

Controls:

- W / Up = Accelerate
- S / Down = Brake
- A / Left = Steer Left
- D / Right = Steer Right
- Space = Handbrake / Drift
- (Future) Jump

---

# Scoring System

## Base Score

- Collecting the ball: +100
- Survival time bonus (minor passive score)

---

## Trick System (Core Mechanic)

Player earns bonus score from performing stunts.

### Drift Points

Triggered when:
- Car angle differs from movement direction beyond threshold.
- Drift maintained for a duration.

Score:
- Points accumulate over time while drifting.
- Multiplied by combo.

---

### Near Miss

Triggered when:
- Car passes within danger radius of obstacle/wall without collision.

Reward:
- Flat bonus (e.g., +150)
- Adds combo stack

---

### Risk Loop (Advanced)

Triggered when:
- Car performs tight circular drift around object or arena feature.

Reward:
- Large bonus
- Multiplies combo significantly

---

# Combo System

- Tricks increase combo multiplier.
- Combo builds when:
  - Tricks are chained.
  - Ball collected during combo.
- Combo resets on:
  - Collision
  - Inactivity
  - Leaving trick state too long

---

# The Ball Mechanic

- One ball spawns in arena.
- Moves slightly or bounces (optional).
- Collecting ball:
  - Adds score
  - Extends combo timer
  - Respawns elsewhere
  - May increase game intensity

Future:
- Multiple balls
- Ball magnet power-up

---

# Arena

Initial MVP:

- Flat isometric arena.
- No elevation.
- Arena bounds enforced.

Future:
- Ramps
- Obstacles
- Moving hazards
- Jump platforms

---

# Physics Model

Arcade-style physics:

Car properties:

```ts
car = {
  x: number,
  y: number,
  velocity: number,
  direction: number,
  driftFactor: number,
  angularVelocity: number
}
```

Key behaviors:

- Acceleration increases forward velocity.
- Friction reduces velocity over time.
- Steering affects angular velocity.
- Drift reduces traction and increases slide.

---

# Collision Rules

- Car collides with arena boundaries.
- Car collides with obstacles.
- Collision:
  - Breaks combo
  - Reduces speed
  - May cause game over (future modes)

---

# Visual Style Direction

- Neon synthwave aesthetic.
- Glowing tire trails.
- Drift sparks.
- Screen shake on heavy drift.
- Slow-motion effect on big trick.

---

# Power-Ups (Planned)

Possible power-ups:

- Speed Boost
- Slow Motion
- Ghost Mode (no collision briefly)
- Super Drift (high scoring drift window)
- Jump Charge

Power-ups:
- Time-limited
- Stackable with combo
- Spawn periodically

---

# MVP Scope

Focus ONLY on:

- Isometric car movement
- Basic drift mechanic
- Single arena
- Ball spawn + collection
- Score counter
- Basic combo system (drift + ball)
- Increasing speed/difficulty over time

Do NOT implement yet:

- Jump
- Ramps
- Obstacles
- Power-ups
- Audio
- Menus
- Online features

---

# Technical Plan (Phaser)

## Core Entities

- Car
- Ball
- Arena
- ScoreSystem
- ComboSystem

---

## Systems Required

- Arcade-style movement update
- Isometric rendering alignment
- Drift detection system
- Combo timer system
- Ball spawn & collision detection
- Basic HUD rendering

---

# Always-True Constraints

- Game is isometric
- Movement is smooth, not grid-based
- Scoring rewards skill
- Combo system central to gameplay
- MVP must feel responsive

---

# AI Implementation Rules

- You MAY use external libraries if needed (e.g., physics helpers).
- Keep logic modular.
- Use Phaser 3 + TypeScript.
- Keep MVP focused.
- Implement incrementally.
- Do not over-engineer.

---

# Phase 1 Implementation Goal

Implement:

1. Isometric arena rendering
2. Car movement with acceleration + steering
3. Drift state detection
4. Basic scoring display
5. Ball spawn + collection
6. Combo increment on drift + ball

After implementation:
- Explain movement math
- Explain drift detection logic
- Confirm modular structure
