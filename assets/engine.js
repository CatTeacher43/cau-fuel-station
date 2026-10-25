/*
 * 农大运动食补站 · 配餐引擎
 * 纯函数，无 DOM 依赖，可在浏览器与 Node 中复用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CAUEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const LABELS = {
    campus: { east: "东校区", west: "西校区" },
    goal: {
      cut: "减脂",
      gain: "增肌",
      maintain: "维持体重",
      recover: "恢复体力"
    },
    exercise: {
      cardio: "有氧训练",
      strength: "力量训练",
      ball: "球类运动",
      light: "轻度活动"
    },
    duration: {
      short: "30 分钟以内",
      mid: "30–60 分钟",
      long: "60 分钟以上"
    },
    restriction: {
      spicy: "不吃辣",
      vegetarian: "素食（蛋奶可）",
      beef: "不吃牛",
      lamb: "不吃羊",
      pork: "不吃猪肉",
      seafood: "海鲜过敏"
    },
    taste: {
      light: "少油清淡",
      normal: "正常口味",
      noodles: "想吃面食"
    }
  };

  const BASE_TARGETS = {
    cut: { kcal: [480, 620], protein: [30, 45], carbs: [40, 65], fat: [12, 22] },
    gain: { kcal: [650, 850], protein: [35, 52], carbs: [85, 120], fat: [16, 30] },
    maintain: { kcal: [550, 720], protein: [26, 40], carbs: [60, 90], fat: [15, 25] },
    recover: { kcal: [600, 800], protein: [22, 38], carbs: [85, 120], fat: [14, 26] }
  };

  const SEAFOOD_MEATS = ["fish", "shrimp", "crab", "shellfish"];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatClock(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function getBeijingTime(now) {
    const date = now instanceof Date ? now : new Date(now || Date.now());
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const value = {};
    parts.forEach((part) => {
      if (part.type !== "literal") value[part.type] = part.value;
    });
    const hour = Number(value.hour || 0);
    const minute = Number(value.minute || 0);
    return {
      minutes: hour * 60 + minute,
      timeLabel: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    };
  }

  function getDinnerWindow(canteen) {
    const dinner = canteen.slots.find((slot) => slot.label === "晚餐");
    if (dinner) {
      return { start: dinner.start, end: dinner.end, allDay: false };
    }
    const allDay = canteen.slots.find((slot) => slot.label === "全天营业");
    if (allDay) {
      return { start: 960, end: allDay.end, allDay: true };
    }
    return { start: 990, end: 1140, allDay: false };
  }

  function getCanteenStatus(canteen, now) {
    const time = getBeijingTime(now);
    const dinner = getDinnerWindow(canteen);
    const active = canteen.slots.find(
      (slot) => time.minutes >= slot.start && time.minutes < slot.end
    );
    const isAllDay = active && active.label === "全天营业";
    const dinnerReady = Boolean(
      active &&
        (active.label === "晚餐" ||
          active.label === "夜宵" ||
          (isAllDay && time.minutes >= dinner.start))
    );

    let statusText = "";
    if (active) {
      if (isAllDay && !dinnerReady) {
        statusText = `营业中 · 晚餐 ${formatClock(dinner.start)} 起`;
      } else if (dinnerReady) {
        statusText = `正在供餐 · 至 ${formatClock(active.end)}`;
      } else {
        statusText = `营业中 · 晚餐 ${formatClock(dinner.start)} 开餐`;
      }
    } else if (time.minutes < dinner.start) {
      statusText = `晚餐 ${formatClock(dinner.start)} 开餐`;
    } else {
      statusText = "今日已收档";
    }

    return {
      open: Boolean(active),
      dinnerReady,
      statusText,
      slotLabel: active ? active.label : "",
      closes: active ? active.end : null,
      closesLabel: active ? formatClock(active.end) : "",
      dinnerStart: dinner.start,
      dinnerEnd: dinner.end,
      timeLabel: time.timeLabel
    };
  }

  function normalizeForm(form) {
    const source = form || {};
    const restrictions = Array.isArray(source.restrictions)
      ? source.restrictions.filter((item) => item && item !== "none")
      : [];
    return {
      campus: source.campus === "west" ? "west" : "east",
      goal: LABELS.goal[source.goal] ? source.goal : "gain",
      exercise: LABELS.exercise[source.exercise] ? source.exercise : "strength",
      duration: LABELS.duration[source.duration] ? source.duration : "mid",
      restrictions: Array.from(new Set(restrictions)),
      taste: LABELS.taste[source.taste] ? source.taste : "normal"
    };
  }

  function getMacroTargets(inputForm) {
    const form = normalizeForm(inputForm);
    const base = BASE_TARGETS[form.goal];
    const target = {
      kcal: base.kcal.slice(),
      protein: base.protein.slice(),
      carbs: base.carbs.slice(),
      fat: base.fat.slice()
    };

    if (form.duration === "short") {
      target.kcal[0] -= 60;
      target.kcal[1] -= 50;
      target.carbs[0] -= 10;
      target.carbs[1] -= 10;
    }
    if (form.duration === "long") {
      target.kcal[0] += 80;
      target.kcal[1] += 100;
      target.carbs[0] += 15;
      target.carbs[1] += 15;
      target.protein[0] += 3;
      target.protein[1] += 3;
    }
    if (form.exercise === "strength") {
      target.protein[0] += 4;
      target.protein[1] += 4;
      target.kcal[0] += 30;
      target.kcal[1] += 30;
    }
    if (form.exercise === "cardio") {
      target.carbs[0] += 10;
      target.carbs[1] += 10;
    }
    if (form.exercise === "ball") {
      target.carbs[0] += 8;
      target.carbs[1] += 8;
      target.kcal[0] += 30;
      target.kcal[1] += 40;
    }
    if (form.exercise === "light") {
      target.kcal[0] -= 90;
      target.kcal[1] -= 80;
      target.carbs[0] -= 12;
      target.carbs[1] -= 12;
    }

    return {
      kcal: target.kcal.map((value) => Math.round(value / 10) * 10),
      protein: target.protein.map((value) => Math.round(value)),
      carbs: target.carbs.map((value) => Math.round(value)),
      fat: target.fat.map((value) => Math.round(value))
    };
  }

  function passesRestrictions(dish, restrictions) {
    const set = new Set(restrictions || []);
    if (set.has("vegetarian") && !dish.veg) return false;
    if (set.has("spicy") && dish.spicy > 0) return false;
    if (set.has("beef") && dish.meats.includes("beef")) return false;
    if (set.has("lamb") && dish.meats.includes("lamb")) return false;
    if (set.has("pork") && dish.meats.includes("pork")) return false;
    if (
      set.has("seafood") &&
      (dish.allergens.includes("seafood") ||
        dish.meats.some((meat) => SEAFOOD_MEATS.includes(meat)))
    ) {
      return false;
    }
    return true;
  }

  function isDishAllowed(dish, restrictions) {
    return !dish.avoid && passesRestrictions(dish, restrictions);
  }

  function sumCombos(items) {
    return items.reduce(
      (total, dish) => {
        total.kcal += dish.kcal;
        total.protein += dish.protein;
        total.carbs += dish.carbs;
        total.fat += dish.fat;
        total.price += dish.price;
        total.oil += dish.oil;
        total.spicy = Math.max(total.spicy, dish.spicy);
        return total;
      },
      { kcal: 0, protein: 0, carbs: 0, fat: 0, price: 0, oil: 0, spicy: 0 }
    );
  }

  function outsidePenalty(value, range, underWeight, overWeight) {
    if (value < range[0]) return (range[0] - value) * underWeight;
    if (value > range[1]) return (value - range[1]) * overWeight;
    return 0;
  }

  function scoreCombo(total, dishes, status, form, target) {
    let score = 100;
    score -= outsidePenalty(total.protein, target.protein, 1.35, 0.15);
    score -= outsidePenalty(total.carbs, target.carbs, 0.38, 0.24);
    score -= outsidePenalty(total.fat, target.fat, 0.08, 0.5);
    score -= outsidePenalty(total.kcal, target.kcal, 0.012, 0.02);

    if (form.goal === "cut") {
      score -= Math.max(0, total.fat - target.fat[1]) * 0.25;
      if (total.protein >= target.protein[0]) score += 2;
    }
    if (form.goal === "gain" && total.protein >= target.protein[0]) {
      score += 2;
    }
    if (form.goal === "recover" && total.carbs >= target.carbs[0]) {
      score += 2;
    }

    const avgOil = total.oil / 3;
    if (form.taste === "light") {
      if (avgOil <= 1.1) score += 7;
      else if (avgOil <= 1.6) score += 2;
      else score -= 8;
    }

    if (form.taste === "noodles") {
      const staple = dishes.find((dish) => dish.role === "staple");
      score += staple && staple.tags.includes("noodle") ? 13 : -9;
    }

    if (status.dinnerReady) score += 5;
    else if (status.open) score += 1;
    else score -= 2;

    if (total.price <= 22) score += 1;
    if (total.price >= 38) score -= 1.5;
    if (dishes.every((dish) => dish.veg)) score += 1;

    return score;
  }

  function comboTags(total, dishes, form) {
    const tags = [];
    const avgOil = total.oil / 3;
    const staple = dishes.find((dish) => dish.role === "staple");
    if (total.protein >= 30) tags.push("高蛋白");
    if (total.carbs >= 75) tags.push("足量碳水");
    if (avgOil <= 1.34) tags.push("少油");
    if (total.spicy === 0) tags.push("不辣");
    if (staple && staple.tags.includes("noodle")) tags.push("面食");
    if (dishes.every((dish) => dish.veg)) tags.push("蛋奶素");
    if (
      dishes.some(
        (dish) =>
          dish.allergens.includes("seafood") ||
          dish.meats.some((meat) => SEAFOOD_MEATS.includes(meat))
      )
    ) {
      tags.push("含海鲜");
    }
    if (form.taste === "light" && avgOil > 1.6) tags.push("偏油");
    return tags.slice(0, 4);
  }

  function comboLabel(total, target, form) {
    if (form.goal === "cut" && total.kcal <= target.kcal[1]) return "低油减脂盘";
    if (form.goal === "gain" && total.protein >= target.protein[0]) return "高蛋白增肌盘";
    if (form.goal === "recover" && total.carbs >= target.carbs[0]) return "碳水恢复盘";
    if (
      total.protein >= target.protein[0] &&
      total.carbs >= target.carbs[0]
    ) {
      return "蛋白碳水双补盘";
    }
    if (total.protein >= target.protein[0]) return "高蛋白轻负担";
    return "均衡训练餐";
  }

  function buildWhy(total, dishes, form, target) {
    const staple = dishes.find((dish) => dish.role === "staple");
    const protein = dishes.find((dish) => dish.role === "protein");
    const avgOil = total.oil / 3;
    const opening = `${staple.name}给到约 ${Math.round(
      staple.carbs
    )}g 碳水，${protein.name}补约 ${Math.round(protein.protein)}g 蛋白。`;

    const exerciseNote = {
      strength: "力量训练后把蛋白和碳水一起吃，比只补蛋白粉更完整。",
      cardio: "有氧后先把碳水补回来，恢复会更顺。",
      ball: "球类消耗大，主食别省，补水也别落下。",
      light: "今天活动量不大，吃到七八分饱就够。"
    }[form.exercise];

    let goalNote = "";
    if (form.goal === "cut") {
      goalNote =
        total.kcal <= target.kcal[1]
          ? "热量控制得住，蛋白质也没掉队。"
          : "想吃这顿的话，主食可以少盛三分之一。";
    } else if (form.goal === "gain") {
      goalNote =
        total.protein >= target.protein[0]
          ? "对增肌目标来说，这一餐的蛋白量够用。"
          : "还可以再加一份蛋或豆浆，把蛋白补齐。";
    } else if (form.goal === "recover") {
      goalNote =
        total.carbs >= target.carbs[0]
          ? "碳水是这顿的主角，适合把体力补回来。"
          : "再添半份主食，恢复会更从容。";
    } else {
      goalNote = "份量均衡，维持期吃这一套不容易过量。";
    }

    let oilNote = "";
    if (form.taste === "light") {
      oilNote =
        avgOil <= 1.34
          ? "整体用油比较克制。"
          : "档口做法偏油，吃前可以少浇一点汁。";
    }

    return `${opening}${exerciseNote}${goalNote}${oilNote}`;
  }

  function pickCanteenCombos(candidates, variant) {
    const byCanteen = new Map();
    candidates.forEach((combo) => {
      if (!byCanteen.has(combo.canteen.id)) byCanteen.set(combo.canteen.id, []);
      byCanteen.get(combo.canteen.id).push(combo);
    });

    const groups = Array.from(byCanteen.values()).sort(
      (a, b) => b[0].score - a[0].score
    );
    if (!groups.length) return [];

    const shift = variant % groups.length;
    const rotated = groups.slice(shift).concat(groups.slice(0, shift));
    const selected = [];
    const usedIds = new Set();

    rotated.forEach((group) => {
      if (selected.length >= 3) return;
      const candidate = group[0];
      if (!usedIds.has(candidate.id)) {
        selected.push(candidate);
        usedIds.add(candidate.id);
      }
    });

    if (selected.length < 3) {
      for (const combo of candidates) {
        if (selected.length >= 3) break;
        if (!usedIds.has(combo.id)) {
          selected.push(combo);
          usedIds.add(combo.id);
        }
      }
    }

    return selected
      .sort((a, b) => b.score - a.score || a.price - b.price)
      .slice(0, 3);
  }

  function getRecommendations(data, inputForm, variant, now) {
    const form = normalizeForm(inputForm);
    const target = getMacroTargets(form);
    const canteens = data.canteens.filter((canteen) => canteen.campus === form.campus);
    const canteenById = new Map(canteens.map((canteen) => [canteen.id, canteen]));
    const canteenStatus = new Map(
      canteens.map((canteen) => [canteen.id, getCanteenStatus(canteen, now)])
    );
    const allowed = data.dishes.filter(
      (dish) =>
        canteenById.has(dish.canteenId) && isDishAllowed(dish, form.restrictions)
    );

    const candidates = [];
    canteens.forEach((canteen) => {
      const canteenDishes = allowed.filter((dish) => dish.canteenId === canteen.id);
      const staples = canteenDishes.filter((dish) => dish.role === "staple");
      const proteins = canteenDishes.filter((dish) => dish.role === "protein");
      const sides = canteenDishes.filter((dish) => dish.role === "side");
      if (!staples.length || !proteins.length || !sides.length) return;

      const status = canteenStatus.get(canteen.id);
      staples.forEach((staple) => {
        proteins.forEach((protein) => {
          sides.forEach((side) => {
            const dishes = [staple, protein, side];
            const total = sumCombos(dishes);
            const score = scoreCombo(total, dishes, status, form, target);
            const rounded = {
              kcal: Math.round(total.kcal / 5) * 5,
              protein: Math.round(total.protein),
              carbs: Math.round(total.carbs),
              fat: Math.round(total.fat),
              price: Math.round(total.price)
            };
            candidates.push({
              id: `${canteen.id}:${staple.id}:${protein.id}:${side.id}`,
              canteen,
              dishes,
              total: rounded,
              price: rounded.price,
              score,
              match: clamp(Math.round(80 + (score - 95) * 0.9), 74, 97),
              status,
              label: comboLabel(rounded, target, form),
              tags: comboTags(total, dishes, form),
              why: buildWhy(total, dishes, form, target),
              oilAvg: total.oil / 3
            });
          });
        });
      });
    });

    candidates.sort((a, b) => b.score - a.score || a.price - b.price);
    const selected = pickCanteenCombos(candidates, Math.max(0, variant || 0));
    const time = getBeijingTime(now);
    const dinnerReadyCount = selected.filter((combo) => combo.status.dinnerReady).length;
    const openCount = selected.filter((combo) => combo.status.open).length;

    return {
      form,
      target,
      combos: selected,
      candidateCount: candidates.length,
      openCount,
      dinnerReadyCount,
      timeLabel: time.timeLabel,
      variant: Math.max(0, variant || 0),
      limited: selected.length < 3
    };
  }

  function getWarnings(data, inputForm, limit) {
    const form = normalizeForm(inputForm);
    const canteenById = new Map(data.canteens.map((canteen) => [canteen.id, canteen]));
    return data.dishes
      .filter(
        (dish) =>
          dish.avoid &&
          canteenById.has(dish.canteenId) &&
          canteenById.get(dish.canteenId).campus === form.campus &&
          passesRestrictions(dish, form.restrictions)
      )
      .slice(0, limit || 3)
      .map((dish) => ({
        id: dish.id,
        name: dish.name,
        canteenName: canteenById.get(dish.canteenId).name,
        reason: dish.avoidReason,
        price: dish.price
      }));
  }

  function getTips(inputForm) {
    const form = normalizeForm(inputForm);
    const goalTip = {
      cut: "减脂不是不吃碳水。练后主食留一拳，蛋白质吃够，比硬扛着不吃更容易坚持。",
      gain: "增肌别只堆蛋白。把主食吃够、蛋白分 3–4 次摄入，身体才更容易用上。",
      maintain: "维持期先夹两拳蔬菜、一掌蛋白，主食按饥饿感加减半拳。",
      recover: "恢复体力优先补碳水，再配一掌蛋白；出汗多时先补水。"
    }[form.goal];

    return [
      {
        kicker: "时机",
        title: "不用卡 30 分钟窗口",
        body: "训练结束后的 2 小时内吃上这顿都算及时。先补水，再慢慢吃。"
      },
      {
        kicker: "目标",
        title: `${LABELS.goal[form.goal]}的这顿怎么吃`,
        body: goalTip
      },
      {
        kicker: "份量",
        title: "一拳、一掌、两拳",
        body: "主食约一拳、蛋白约一掌、蔬菜约两拳。食堂菜偏油时少浇汁，或先用热水涮一下。"
      }
    ];
  }

  function getCampusOpenCount(data, campus, now) {
    return data.canteens.filter(
      (canteen) => canteen.campus === campus && getCanteenStatus(canteen, now).open
    ).length;
  }

  return {
    LABELS,
    BASE_TARGETS,
    getBeijingTime,
    getCanteenStatus,
    getMacroTargets,
    normalizeForm,
    passesRestrictions,
    isDishAllowed,
    getRecommendations,
    getWarnings,
    getTips,
    getCampusOpenCount,
    formatClock
  };
});
