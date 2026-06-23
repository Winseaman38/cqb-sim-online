// ===========================================================================
// formations.js — Formation definitions (Stack/Wedge/Line/Diamond/File),
// slot offset calculation relative to facing direction, sector assignment
// ===========================================================================

const FORMATIONS = (() => {

  const SPACING = 0.9; // meters between unit slots

  // Each formation defines slot offsets (relative to formation facing angle=0, i.e. +X forward)
  // offset.x = forward distance, offset.z = lateral (right positive)
  // sectorAngle = relative angle (radians) this slot should cover, relative to formation facing
  const FORMATION_DEFS = {
    stack: {
      label: 'Stack',
      slots: (n) => {
        // single file along the wall, alternating in entry order, all facing forward (toward door)
        const arr = [];
        for (let i = 0; i < n; i++) {
          arr.push({ x: -i * SPACING * 0.7, z: (i % 2 === 0 ? -0.28 : 0.28), sectorAngle: 0 });
        }
        return arr;
      },
    },
    wedge: {
      label: 'Wedge',
      slots: (n) => {
        // #1 point, others fan back left/right
        const arr = [{ x: 0, z: 0, sectorAngle: 0 }];
        const sectorSteps = [-0.9, 0.9, -2.0, 2.0]; // radians offsets for #2,#3,#4,#5 roughly covering flanks/rear
        for (let i = 1; i < n; i++) {
          const side = i % 2 === 1 ? -1 : 1; // alternate left/right
          const rank = Math.ceil(i / 2);
          arr.push({
            x: -rank * SPACING,
            z: side * rank * SPACING * 0.9,
            sectorAngle: sectorSteps[i - 1] !== undefined ? sectorSteps[i - 1] : Math.PI,
          });
        }
        return arr;
      },
    },
    line: {
      label: 'Line',
      slots: (n) => {
        const arr = [];
        const totalWidth = (n - 1) * SPACING;
        for (let i = 0; i < n; i++) {
          arr.push({ x: 0, z: -totalWidth / 2 + i * SPACING, sectorAngle: 0 });
        }
        return arr;
      },
    },
    diamond: {
      label: 'Diamond',
      slots: (n) => {
        // up to 4 cardinal points covering 360; extra units stack at rear
        const base = [
          { x: SPACING, z: 0, sectorAngle: 0 },           // front: 12 o'clock
          { x: 0, z: -SPACING, sectorAngle: -Math.PI / 2 }, // left: 9 o'clock
          { x: 0, z: SPACING, sectorAngle: Math.PI / 2 },   // right: 3 o'clock
          { x: -SPACING, z: 0, sectorAngle: Math.PI },      // rear: 6 o'clock
        ];
        const arr = base.slice(0, Math.min(n, 4));
        for (let i = 4; i < n; i++) {
          arr.push({ x: -SPACING * 1.6, z: (i - 4) * SPACING * 0.6 - 0.3, sectorAngle: Math.PI });
        }
        return arr;
      },
    },
    file: {
      label: 'File',
      slots: (n) => {
        // Fixed CQB file roles:
        // #1 Pointman   -> covers front (12 o'clock)
        // #2             -> covers flank (9 o'clock)
        // #3 Team Leader -> covers opposite flank (3 o'clock), commands from #3 slot
        // #4 Rear        -> covers rear (6 o'clock)
        // #5+ additional -> alternate flank coverage
        const roleSectors = [0, -Math.PI / 2, Math.PI / 2, Math.PI];
        const roleLabels = ['POINTMAN', 'FLANK', 'TEAM LEADER', 'REAR'];
        const arr = [];
        for (let i = 0; i < n; i++) {
          let sectorAngle, role;
          if (i < roleSectors.length) {
            sectorAngle = roleSectors[i];
            role = roleLabels[i];
          } else {
            // beyond 4 units: alternate additional flank coverage
            sectorAngle = (i % 2 === 0) ? -Math.PI / 2 : Math.PI / 2;
            role = 'FLANK';
          }
          arr.push({ x: -i * SPACING, z: 0, sectorAngle, role });
        }
        return arr;
      },
    },
  };

  let currentFormation = null; // {type, anchorX, anchorZ, facingAngle, units:[]}

  function getFormationTypes() {
    return Object.keys(FORMATION_DEFS).map(key => ({ key, label: FORMATION_DEFS[key].label }));
  }

  // Apply a formation to a list of selected units, anchored at their current centroid,
  // facing toward facingAngle (radians). Units pathfind (direct+collision) to slots.
  function applyFormation(unitList, formationType, facingAngle) {
    if (unitList.length === 0) return;
    const def = FORMATION_DEFS[formationType];
    if (!def) return;

    // centroid as anchor
    let cx = 0, cz = 0;
    for (const u of unitList) { cx += u.x; cz += u.z; }
    cx /= unitList.length; cz /= unitList.length;

    const slots = def.slots(unitList.length);
    const cosA = Math.cos(facingAngle), sinA = Math.sin(facingAngle);

    unitList.forEach((unit, i) => {
      const slot = slots[i];
      // rotate slot offset by facing angle
      const rx = slot.x * cosA - slot.z * sinA;
      const rz = slot.x * sinA + slot.z * cosA;
      const targetX = cx + rx;
      const targetZ = cz + rz;

      UNITS.setMoveTarget(unit, targetX, targetZ);
      // assign absolute sector angle = facing + relative sector offset
      unit.sectorAngle = facingAngle + slot.sectorAngle;
      unit.formationSlot = i;
      unit.role = slot.role || null;
    });

    currentFormation = { type: formationType, facingAngle, anchorX: cx, anchorZ: cz };
    if (window.UI) UI.setFormationLabel(def.label);
    if (window.NETWORK && NETWORK.isConnected()) {
      NETWORK.sendUnitsSync(UNITS.getAllUnits());
    }
  }

  function getCurrentFormation() { return currentFormation; }

  // Recompute facing angle toward a target point (e.g. a door) for stack-up
  function facingAngleToward(fromX, fromZ, toX, toZ) {
    return Math.atan2(toZ - fromZ, toX - fromX);
  }

  return {
    getFormationTypes, applyFormation, getCurrentFormation, facingAngleToward,
    FORMATION_DEFS,
  };
})();
