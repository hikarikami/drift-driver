# Neon Drift - Desert Runner (Working Title)

## One-Sentence Pitch

An isometric arcade stunt-driving game where players drift through a desert arena, chain tricks near obstacles, and collect trophies to survive as long as possible in a timed run.

---

# What Is This Game?

Neon Drift is a **time-attack trick-driving game** where you:

- **Drift** through a desert arena filled with obstacles
- **Chain tricks** by combining near-misses and handbrake stunts
- **Collect trophies** to extend your time
- **Build combo multipliers** to maximize your score
- **Survive** as long as possible before the timer runs out

It's **not about racing** — it's about **style, risk, and combo mastery**.

---

# Core Loop

1. **Drive** through the arena with arcade physics
2. **Drift** to activate the trick system
3. **Perform tricks** (near-miss obstacles, handbrake drifts)
4. **Chain tricks** to build combo multipliers
5. **Collect trophies** to add time to your run
6. **Avoid crashing** or tricks fail and combos reset
7. **Score as high as possible** before time expires

---

# Game Mechanics

## Driving Physics

**Arcade-style handling:**
- Forward thrust (W/Up)
- Braking (S/Down)
- Steering (A/D or Left/Right arrows)
- Handbrake/Drift (Space)
- Boost (Shift) - consumes boost fuel

**Physics properties:**
- Speed increases with forward thrust
- Drag slows the car naturally
- Handbrake enables drifting (reduced traction)
- Collisions dramatically reduce speed and bounce the car away

---

## Drift System

**How it works:**
- Hold handbrake (Space) while moving
- Tire mark intensity indicates drift strength
- Triggers when tire marks are visible (intensity > 0.2)

**Visual feedback:**
- Tire mark trails fade in during drift
- Marks persist for 500ms after drift ends
- Intensity affects mark opacity

**Drift is required to:**
- Trigger the trick system
- Score near-miss tricks
- Score handbrakey tricks

---

## Trick System (Standardized Architecture)

### **Active Tricks** (In Progress)
Tricks actively being performed, shown with `...` indicator:
- Display updates in real-time
- Show live score accumulation
- Visible at bottom center of screen

### **Buffered Tricks** (Completed)
Tricks finished but waiting for drift session to end:
- Stored until drift ends
- Contribute to total combo score
- Not scored until session finalizes

---

## Current Tricks

### **1. Near Miss**
**Trigger:** Drift within 40 pixels of an obstacle's edge

**Scoring:**
- Base: 50 points per obstacle
- Chainable (adds to combo multiplier)

**How it works:**
- System tracks distance from each obstacle
- Enters active state when within threshold
- Completes when you move away from all obstacles
- Multiple obstacles = multiple near-misses

**Display:** `"Near Miss..."`

---

### **2. Handbrakey**
**Trigger:** Hold handbrake (Space) while drifting for 1+ seconds

**Scoring:**
- Base: 10 points per second held
- Chainable (adds to combo multiplier)

**How it works:**
- Starts immediately when handbrake pressed during drift
- Accumulates 1 instance per second
- Live counter shows seconds held
- Completes when handbrake released

**Display:** `"Handbrakey + Handbrakey... | 20 pts"`

---

## Combo System

### **Multiplier Mechanics**
- Starts at 1x
- Each chainable trick adds +0.5x to multiplier
- Example: Near Miss (50) → Handbrakey (10×1.5) → Handbrakey (10×2.0) = 85 points

### **Combo Window**
- 2 second window to chain tricks
- Resets after 2 seconds of no new tricks
- Displays current multiplier: `x2.0`

### **Combo Display**
Shows at bottom center:
```
Near Miss + Handbrakey + Handbrakey x2.0
70 pts
```

---

## Trick Session Lifecycle

### **AC1: Initiation**
Any trick trigger immediately shows "Trick in Progress"
- Near-miss enters range: Display appears
- Handbrake held: Display appears

### **AC2: Active Updates**
Display updates in real-time while tricks are active
- Shows trick names with `...` indicator
- Live score preview
- Updates every frame

### **AC3: Completion**
Trick session ends when:
- Drift stops AND
- No active tricks remain

**On Success:**
- Text turns green
- Sound effect plays
- Score added to total
- Animate upward and fade
- Stays visible 1.5 seconds before animating

### **AC4: Failure**
Session fails if:
- Player crashes into obstacle

**On Failure:**
- Text turns red
- No sound
- No score awarded
- Drops downward off screen
- All tricks cancelled

### **AC5: History**
All completed tricks stored in `trickHistory[]` for:
- End-of-run summary
- Statistics tracking
- (Future: detailed trick breakdown display)

---

## Trophy Collection

**Pickup mechanic:**
- Golden trophies spawn in arena
- Drive through to collect
- Auto-respawns at new random location

**Reward:**
- **+5 seconds** added to timer
- Trophy count tracked (future scoring bonus)

**Visual feedback:**
- Time bonus popup: `"+5s"`
- Trophy respawns instantly elsewhere
- Popup animates upward and fades

---

## Time System

**Countdown Timer:**
- Starts at 60 seconds
- Counts down continuously
- Large display at top center
- Game over when reaches 0

**Time Extensions:**
- Trophy collection: +5 seconds
- Maximum time: 99 seconds

**Game Over:**
- Displays final score
- Shows trick count if any tricks performed
- "Play Again" button to restart

---

## Obstacle System

**Cactus Obstacles:**
- 9 large collision obstacles (scale 2.75)
- Physics-enabled with collision detection
- Arranged with 145px minimum spacing
- Shadows cast at 130° angle

**Decorative Scenery:**
- 25 smaller cacti (scale 0.6)
- No collision (visual only)
- 7 different tree/cactus variants
- Depth-sorted for proper layering

**Collision Physics:**
- **Speed loss:** Car loses 80% of speed on impact
- **Bounce force:** Speed-tiered (faster = less bounce)
  - <75 speed: 320 force
  - 75-175: 280 force
  - 175-275: 250 force
  - 275+: 230 force
- **Cooldown:** 300ms between collisions
- **Sound effects:** 3 crash sounds based on impact speed

---

## Boost System

**Boost Fuel:**
- Max: 100 units
- Regenerates slowly over time
- Consumed when boost active

**Boost Mechanic:**
- Activated: Hold Shift
- Multiplies forward thrust
- Visual: Boost bar depletes
- Cannot boost when fuel empty

**Boost Bar Display:**
- Located below score (top left)
- Shows current fuel level
- Color-coded fill indicator

---

## Debug Tools

**Debug Modal (⚙️ button):**
- Thrust adjustment (80-800)
- Drag adjustment (0-400)
- Max Speed adjustment (80-600)
- Music toggle
- SFX toggle
- Screen bounce toggle
- Show hitboxes toggle
- **Show trick threshold** (green zones around obstacles)
- Collisions on/off toggle
- End run button

**Debug Overlay:**
- Speed display
- Current thrust value
- Drift indicator `[DRIFT]`
- Nearest obstacle distance (when drifting)

---

## Visual & Audio

### **Visual Feedback**
- Tire mark trails during drift
- Car shadow (positioned beneath)
- Obstacle shadows (cast at angle)
- Trophy glow (removed - was causing visual clutter)
- Trick combo display (bottom center)
- Success/fail animations (green/red)

### **Sound System**
Layered engine sounds:
- **Idle layer:** 0-50 speed
- **Cruise layer:** 50-150 speed
- **Fast layer:** 150+ speed
- **Boost layer:** When boosting
- **Stopping layer:** When braking

**Sound Effects:**
- 3 crash sounds (speed-based)
- Drift/screech sound
- Trick completion sound
- (Trick sound currently placeholder)

---

## Arena Design

**Current Setup:**
- Isometric top-down view
- Desert/wasteland theme
- Tiled sand background
- Screen bounds collision
- 800×600 game area

**Spawning Rules:**
- Obstacles avoid edges (85px margin)
- Obstacles maintain spacing (145px)
- Decorations avoid obstacles (15px spacing)
- Car spawns in safe location on restart

---

## Scoring Breakdown

### **Score Components**
1. **Trick points** (primary scoring)
   - Near Miss: 50 base × multiplier
   - Handbrakey: 10/sec × multiplier
   
2. **Trophy collection** (time extension only, no points currently)

3. **Combo multipliers** (exponential scoring)
   - 1st trick: 1x
   - 2nd trick: 1.5x
   - 3rd trick: 2x
   - 4th trick: 2.5x
   - etc.

### **Example High Score Run**
```
Drift near 3 obstacles: 50 + 75 + 100 = 225 pts
Hold handbrake 4 seconds: 12.5 + 15 + 17.5 + 20 = 65 pts
Total: 290 pts in one combo!
```

---

## Game States

### **Playing**
- Car active and controllable
- Timer counting down
- Tricks can be performed
- Trophies spawn

### **Game Over**
- Timer reached 0
- Final score displayed
- Trick summary shown
- Play Again option

### **Restart**
- Resets all systems
- Clears trick history
- Respawns car safely
- Resets timer to 60s

---

## Technical Architecture

**Framework:** Phaser 3 + TypeScript

**Key Classes:**
- `Game.ts` - Main game scene
- `Preloader.ts` - Asset loading
- `SoundManager.ts` - Audio layering system

**Trick System:**
```typescript
activeTricks: Map<string, number>  // In-progress tricks
bufferedTricks: string[]           // Completed tricks
trickHistory: CompletedTrick[]     // All-time record
```

**Collision Detection:**
- Phaser Arcade Physics
- Body-to-body collision
- Distance calculations for near-miss
- Edge-to-edge distance measurement

---

## Future Expansion Points

**Planned Tricks:**
- Jump trick (airtime scoring)
- Perfect drift (sustained drift bonus)
- Speed demon (high-speed near-miss)
- Combo finisher (big trick to end chain)

**Planned Features:**
- Jump ramps
- Moving obstacles
- Power-ups
- Multiple arenas
- Online leaderboards
- Ghost racing (replay system)
- Daily challenges

**Polish:**
- Particle effects for tricks
- Screen shake on impact
- Slow-motion on big combos
- Better trick sound effects
- Background music
- Menu system

---

## Design Philosophy

**Core Pillars:**
1. **Risk vs Reward** - Closer to obstacles = more points
2. **Flow State** - Chaining tricks feels rhythmic
3. **Readability** - Always clear what trick is active
4. **Immediate Feedback** - Visual/audio confirms every action
5. **Arcade Feel** - Responsive, forgiving, fun > realistic

**Balance Goals:**
- Tricks should feel achievable but require skill
- Combos should be exciting but not too easy
- Timer creates urgency without frustration
- Crashes punish but don't end the run

---

## Key Metrics (Current)

**Trick Thresholds:**
- Near-miss: 40 pixels from obstacle edge
- Handbrakey: 1 second minimum hold
- Combo window: 2 seconds
- Collision cooldown: 300ms

**Timing:**
- Start time: 60 seconds
- Trophy bonus: +5 seconds
- Max time: 99 seconds
- Trick display delay: 1.5 seconds before fade

**Physics:**
- Max speed: 400 (adjustable in debug)
- Forward thrust: 325 (adjustable)
- Drag: 100 (adjustable)
- Collision speed loss: 80%

---

## Current Status

**Implemented:**
✅ Full driving physics
✅ Drift system with visual feedback
✅ 2 trick types (Near Miss, Handbrakey)
✅ Standardized trick architecture
✅ Combo multiplier system
✅ Trophy collection with time bonus
✅ Collision detection and physics
✅ Sound system with layered engine
✅ Debug tools
✅ Score tracking
✅ Game over/restart flow

**In Progress:**
🔨 Trick display polish (some glitches)
🔨 Additional trick types
🔨 End-of-run trick summary display

**Not Yet Implemented:**
⏳ Jump mechanic
⏳ Ramps
⏳ Power-ups
⏳ Menu system
⏳ Multiple arenas
⏳ Leaderboards
⏳ Background music

---

# Play Pattern

A typical successful run:
1. Start driving, build up speed
2. Spot a cluster of obstacles
3. Initiate drift near them
4. Pull off 2-3 near-misses
5. Hold handbrake for extra points
6. Finish drift session → green text → combo scored!
7. Grab trophy for +5 seconds
8. Repeat, chaining bigger combos
9. Push for high score before time expires

The game rewards:
- **Planning routes** through obstacle clusters
- **Risk-taking** (closer = more points)
- **Combo management** (when to end session)
- **Time management** (trophy routing)
- **Mechanical skill** (drift control, handbrake timing)
