"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const DATA = require(path.join(__dirname, "..", "assets", "data.js"));
const Engine = require(path.join(__dirname, "..", "assets", "engine.js"));

// 2026-10-24 16:30 Beijing time. Fixed so results do not depend on the clock.
const NOW = new Date("2026-10-24T08:30:00Z");
const RESTRICTIONS = ["spicy", "vegetarian", "beef", "lamb", "pork", "seafood"];
const ROLES = ["staple", "protein", "side"];

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL  ${name}`);
    throw error;
  }
}

function form(overrides) {
  return Object.assign(
    {
      campus: "east",
      goal: "gain",
      exercise: "strength",
      duration: "mid",
      restrictions: [],
      taste: "normal"
    },
    overrides
  );
}

function recommend(overrides, variant, now) {
  return Engine.getRecommendations(
    DATA,
    form(overrides),
    variant || 0,
    now || NOW
  );
}

function assertComboIsSafe(combo, campus) {
  assert.equal(combo.dishes.length, 3, "combo has three dishes");
  assert.deepEqual(
    combo.dishes.map((dish) => dish.role).sort(),
    ROLES.slice().sort(),
    "combo covers staple + protein + side"
  );
  combo.dishes.forEach((dish) => {
    assert.equal(dish.avoid, false, `${dish.name} is not an avoid dish`);
    assert.equal(
      DATA.canteens.find((canteen) => canteen.id === dish.canteenId).campus,
      campus,
      `${dish.name} belongs to the requested campus`
    );
  });
  assert.ok(combo.match >= 74 && combo.match <= 97, "match score stays in range");
}

console.log("\nData integrity");
test("has 11 canteens across both campuses", () => {
  assert.equal(DATA.canteens.length, 11);
  assert.equal(DATA.canteens.filter((item) => item.campus === "east").length, 6);
  assert.equal(DATA.canteens.filter((item) => item.campus === "west").length, 5);
});

test("canteen and dish identifiers are unique", () => {
  const canteenIds = DATA.canteens.map((item) => item.id);
  const dishIds = DATA.dishes.map((item) => item.id);
  assert.equal(new Set(canteenIds).size, canteenIds.length);
  assert.equal(new Set(dishIds).size, dishIds.length);
});

test("every canteen has a staple, protein and side", () => {
  DATA.canteens.forEach((canteen) => {
    const dishes = DATA.dishes.filter((dish) => dish.canteenId === canteen.id);
    ROLES.forEach((role) => {
      assert.ok(
        dishes.some((dish) => dish.role === role),
        `${canteen.name} is missing ${role}`
      );
    });
  });
});

test("every dish points at an existing canteen and has usable nutrition", () => {
  const canteenIds = new Set(DATA.canteens.map((item) => item.id));
  DATA.dishes.forEach((dish) => {
    assert.ok(canteenIds.has(dish.canteenId), `${dish.id} has an unknown canteen`);
    ["kcal", "protein", "carbs", "fat", "price", "oil", "spicy"].forEach((key) => {
      assert.ok(Number.isFinite(dish[key]) && dish[key] >= 0, `${dish.id}.${key}`);
    });
    assert.ok(Array.isArray(dish.meats));
    assert.ok(Array.isArray(dish.allergens));
    assert.ok(typeof dish.veg === "boolean");
  });
});

test("every avoid dish explains why it is flagged", () => {
  DATA.dishes
    .filter((dish) => dish.avoid)
    .forEach((dish) => {
      assert.ok(dish.avoidReason && dish.avoidReason.trim().length > 0, dish.id);
    });
});

console.log("\nRecommendation matrix");
test("all 288 campus/goal/exercise/duration/taste combinations return 3 safe combos", () => {
  let checked = 0;
  ["east", "west"].forEach((campus) => {
    ["cut", "gain", "maintain", "recover"].forEach((goal) => {
      ["cardio", "strength", "ball", "light"].forEach((exercise) => {
        ["short", "mid", "long"].forEach((duration) => {
          ["light", "normal", "noodles"].forEach((taste) => {
            const result = recommend({ campus, goal, exercise, duration, taste });
            assert.equal(result.combos.length, 3, `${campus}/${goal}/${exercise}/${duration}/${taste}`);
            assert.equal(result.limited, false);
            assert.equal(new Set(result.combos.map((combo) => combo.canteen.id)).size, 3);
            result.combos.forEach((combo) => assertComboIsSafe(combo, campus));
            checked += 1;
          });
        });
      });
    });
  });
  assert.equal(checked, 288);
});

test("same input is deterministic", () => {
  const a = recommend({ campus: "west", goal: "cut" });
  const b = recommend({ campus: "west", goal: "cut" });
  assert.deepEqual(
    a.combos.map((combo) => combo.id),
    b.combos.map((combo) => combo.id)
  );
});

test("换一批 rotates the canteen mix", () => {
  const sets = new Set();
  for (let variant = 0; variant < 6; variant += 1) {
    const result = recommend({}, variant);
    sets.add(result.combos.map((combo) => combo.canteen.id).join(","));
  }
  assert.ok(sets.size >= 4, `expected several distinct batches, got ${sets.size}`);
});

console.log("\nRestriction safety");
test("all 64 restriction combinations stay within the rules on both campuses", () => {
  let checked = 0;
  for (let mask = 0; mask < 64; mask += 1) {
    const restrictions = RESTRICTIONS.filter((_, index) => mask & (1 << index));
    ["east", "west"].forEach((campus) => {
      ["cut", "gain", "maintain", "recover"].forEach((goal) => {
        const result = recommend({ campus, goal, restrictions });
        assert.equal(result.combos.length, 3);
        result.combos.forEach((combo) => {
          assertComboIsSafe(combo, campus);
          combo.dishes.forEach((dish) => {
            assert.ok(
              Engine.passesRestrictions(dish, restrictions),
              `${dish.name} violates ${restrictions.join("+")}`
            );
          });
        });
        const warnings = Engine.getWarnings(DATA, { campus, restrictions }, 10);
        warnings.forEach((warning) => {
          const dish = DATA.dishes.find((item) => item.id === warning.id);
          assert.equal(dish.avoid, true);
          assert.ok(Engine.passesRestrictions(dish, restrictions));
        });
        checked += 1;
      });
    });
  }
  assert.equal(checked, 512);
});

test("each restriction removes the dishes it names", () => {
  RESTRICTIONS.forEach((restriction) => {
    const allowed = DATA.dishes.filter((dish) =>
      Engine.passesRestrictions(dish, [restriction])
    );
    assert.ok(allowed.length > 0, restriction);
    allowed.forEach((dish) => {
      if (restriction === "spicy") assert.equal(dish.spicy, 0, dish.name);
      if (restriction === "vegetarian") assert.equal(dish.veg, true, dish.name);
      if (restriction === "beef") assert.ok(!dish.meats.includes("beef"), dish.name);
      if (restriction === "lamb") assert.ok(!dish.meats.includes("lamb"), dish.name);
      if (restriction === "pork") assert.ok(!dish.meats.includes("pork"), dish.name);
      if (restriction === "seafood") {
        assert.ok(!dish.allergens.includes("seafood"), dish.name);
        assert.ok(
          !dish.meats.some((meat) =>
            ["fish", "shrimp", "crab", "shellfish"].includes(meat)
          ),
          dish.name
        );
      }
    });
  });
});

test("warnings come from the requested campus and respect restrictions", () => {
  const result = Engine.getWarnings(
    DATA,
    { campus: "west", restrictions: ["seafood"] },
    3
  );
  assert.ok(result.length > 0);
  result.forEach((warning) => {
    const dish = DATA.dishes.find((item) => item.id === warning.id);
    const canteen = DATA.canteens.find((item) => item.id === dish.canteenId);
    assert.equal(canteen.campus, "west");
    assert.equal(dish.avoid, true);
    assert.ok(Engine.passesRestrictions(dish, ["seafood"]));
  });
});

console.log("\nMacro targets and time");
test("longer and heavier training raises the energy target", () => {
  const short = Engine.getMacroTargets(form({ duration: "short" }));
  const long = Engine.getMacroTargets(form({ duration: "long" }));
  assert.ok(long.kcal[0] > short.kcal[0]);
  assert.ok(long.carbs[0] > short.carbs[0]);

  const strength = Engine.getMacroTargets(form({ exercise: "strength" }));
  const light = Engine.getMacroTargets(form({ exercise: "light" }));
  assert.ok(strength.protein[1] > light.protein[1]);
  assert.ok(strength.kcal[1] > light.kcal[1]);
});

test("Beijing time is independent of the host timezone", () => {
  assert.equal(Engine.getBeijingTime(NOW).timeLabel, "16:30");
  assert.equal(Engine.formatClock(990), "16:30");
  assert.equal(Engine.formatClock(1200), "20:00");
});

test("dinner status flips only at the canteen's opening time", () => {
  const canteen = DATA.canteens.find((item) => item.id === "gongyi");
  const before = Engine.getCanteenStatus(canteen, new Date("2026-10-24T08:29:00Z"));
  const atOpen = Engine.getCanteenStatus(canteen, NOW);
  // 22:00 Beijing: dinner and late-night service have both ended.
  const after = Engine.getCanteenStatus(canteen, new Date("2026-10-24T14:00:00Z"));

  assert.equal(before.open, false);
  assert.equal(before.dinnerReady, false);
  assert.equal(atOpen.open, true);
  assert.equal(atOpen.dinnerReady, true);
  assert.equal(after.open, false);
});

test("all-day canteens distinguish open from dinner-ready", () => {
  const canteen = DATA.canteens.find((item) => item.id === "yaner");
  const beforeDinner = Engine.getCanteenStatus(
    canteen,
    new Date("2026-10-24T07:59:00Z")
  );
  const atDinner = Engine.getCanteenStatus(canteen, new Date("2026-10-24T08:00:00Z"));
  assert.equal(beforeDinner.open, true);
  assert.equal(beforeDinner.dinnerReady, false);
  assert.equal(atDinner.open, true);
  assert.equal(atDinner.dinnerReady, true);
});

test("open counts only include the requested campus", () => {
  const east = Engine.getCampusOpenCount(DATA, "east", NOW);
  const west = Engine.getCampusOpenCount(DATA, "west", NOW);
  const expectedEast = DATA.canteens.filter(
    (canteen) =>
      canteen.campus === "east" && Engine.getCanteenStatus(canteen, NOW).open
  ).length;
  assert.equal(east, expectedEast);
  assert.ok(west >= 0);
});

console.log("\nForm handling");
test("invalid and duplicate values are normalized", () => {
  const normalized = Engine.normalizeForm({
    campus: "west",
    goal: "not-a-goal",
    exercise: "not-an-exercise",
    duration: "not-a-duration",
    taste: "not-a-taste",
    restrictions: ["spicy", "spicy", "none", ""]
  });
  assert.equal(normalized.campus, "west");
  assert.equal(normalized.goal, "gain");
  assert.equal(normalized.exercise, "strength");
  assert.equal(normalized.duration, "mid");
  assert.equal(normalized.taste, "normal");
  assert.deepEqual(normalized.restrictions, ["spicy"]);
});

test("tips are generated for every goal", () => {
  ["cut", "gain", "maintain", "recover"].forEach((goal) => {
    const tips = Engine.getTips({ goal });
    assert.equal(tips.length, 3);
    assert.ok(tips.some((tip) => tip.title.includes(Engine.LABELS.goal[goal])));
  });
});

console.log(`\n${passed} tests passed.\n`);
