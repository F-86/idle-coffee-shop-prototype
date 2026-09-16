(function () {
  "use strict";

  var STORAGE_KEY = "mellow-bean-idle-v1";
  var OFFLINE_CAP_SECONDS = 4 * 60 * 60;

  var upgradeConfig = {
    machine: {
      name: "磨豆机",
      effect: "制作速度",
      baseCost: 70,
      costScale: 1.46
    },
    recipe: {
      name: "招牌配方",
      effect: "单杯售价",
      baseCost: 95,
      costScale: 1.52
    },
    seats: {
      name: "窗边座位",
      effect: "接待人数",
      baseCost: 120,
      costScale: 1.58
    },
    marketing: {
      name: "街角传单",
      effect: "顾客到店",
      baseCost: 145,
      costScale: 1.63
    }
  };

  var drinkConfig = {
    americano: {
      name: "美式",
      shortName: "美式",
      mood: "今天想喝一杯清爽的美式",
      basePrice: 8,
      tip: 1.2,
      brewSeconds: 2.5,
      unlockAt: 0
    },
    latte: {
      name: "蜂蜜拿铁",
      shortName: "拿铁",
      mood: "请给我一杯绵密的蜂蜜拿铁",
      basePrice: 12,
      tip: 2.1,
      brewSeconds: 3.4,
      unlockAt: 1
    },
    mocha: {
      name: "燕麦摩卡",
      shortName: "摩卡",
      mood: "今天想奖励自己一杯燕麦摩卡",
      basePrice: 18,
      tip: 3.5,
      brewSeconds: 4.2,
      unlockAt: 2
    }
  };

  function seedActivities() {
    var now = Date.now();
    return [
      { icon: "✦", iconClass: "icon-bean", message: "新的一天，从一杯好咖啡开始。", time: now - 15000 },
      { icon: "♡", iconClass: "icon-heart", message: "苏女士说，今天的拿铁很顺滑。", time: now - 120000 },
      { icon: "☼", iconClass: "icon-sun", message: "阳光照进了靠窗的座位。", time: now - 300000 }
    ];
  }

  function createDefaultState() {
    return {
      coins: 120,
      totalEarned: 120,
      todayEarned: 0,
      totalServed: 18,
      todayServed: 18,
      tipJar: 8,
      selectedDrink: "americano",
      manualOrdersServed: 0,
      staff: 1,
      isOpen: true,
      boostUntil: 0,
      lastSeen: Date.now(),
      goalClaimed: false,
      goalReachedNotified: false,
      lastLoggedTen: 1,
      upgrades: {
        machine: 0,
        recipe: 0,
        seats: 0,
        marketing: 0
      },
      activities: seedActivities()
    };
  }

  function readSavedState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  var savedState = readSavedState();
  var state = createDefaultState();

  if (savedState && typeof savedState === "object") {
    state = Object.assign(state, savedState);
    state.upgrades = Object.assign(createDefaultState().upgrades, savedState.upgrades || {});
    state.activities = Array.isArray(savedState.activities) && savedState.activities.length
      ? savedState.activities
      : seedActivities();
  }

  state.coins = Number(state.coins) || 0;
  state.totalEarned = Number(state.totalEarned) || 0;
  state.todayEarned = Number(state.todayEarned) || 0;
  state.totalServed = Number(state.totalServed) || 0;
  state.todayServed = Number(state.todayServed) || 0;
  state.tipJar = Number(state.tipJar) || 0;
  state.manualOrdersServed = Math.max(0, Number(state.manualOrdersServed) || 0);
  state.selectedDrink = drinkConfig[state.selectedDrink] ? state.selectedDrink : "americano";
  state.staff = Math.max(1, Number(state.staff) || 1);
  state.lastSeen = Number(state.lastSeen) || Date.now();

  var orderPeople = [
    { name: "苏女士", avatar: "苏" },
    { name: "林先生", avatar: "林" },
    { name: "陈同学", avatar: "陈" },
    { name: "乔小姐", avatar: "乔" }
  ];
  var orderCursor = 0;
  var orderState = {
    customer: "苏女士",
    avatar: "苏",
    drink: "americano",
    mood: drinkConfig.americano.mood,
    isBrewing: false,
    progress: 0,
    startedAt: 0
  };

  function isDrinkUnlocked(key) {
    return (Number(state.upgrades.recipe) || 0) >= drinkConfig[key].unlockAt;
  }

  function getAvailableDrinkKeys() {
    return Object.keys(drinkConfig).filter(function (key) {
      return isDrinkUnlocked(key);
    });
  }

  function getDrinkPrice(key) {
    var recipeLevel = Number(state.upgrades.recipe) || 0;
    return drinkConfig[key].basePrice + recipeLevel * 0.75;
  }

  function getDrinkBrewSeconds(key) {
    var machineLevel = Number(state.upgrades.machine) || 0;
    return Math.max(1.2, drinkConfig[key].brewSeconds - machineLevel * 0.16);
  }

  function createOrder() {
    var available = getAvailableDrinkKeys();
    var drinkKey = available[orderCursor % available.length] || "americano";
    var person = orderPeople[orderCursor % orderPeople.length];
    orderCursor += 1;
    orderState = {
      customer: person.name,
      avatar: person.avatar,
      drink: drinkKey,
      mood: drinkConfig[drinkKey].mood,
      isBrewing: false,
      progress: 0,
      startedAt: 0
    };
  }

  createOrder();

  function getEconomy(multiplierOverride) {
    var machineLevel = Number(state.upgrades.machine) || 0;
    var recipeLevel = Number(state.upgrades.recipe) || 0;
    var seatsLevel = Number(state.upgrades.seats) || 0;
    var marketingLevel = Number(state.upgrades.marketing) || 0;
    var staffBonus = Math.max(0, state.staff - 1) * 4.1;
    var cupsPerMinute = (6 + machineLevel * 2.1 + seatsLevel * 0.8 + staffBonus) * (1 + marketingLevel * 0.14);
    var pricePerCup = 7 + recipeLevel * 1.8;
    var multiplier = typeof multiplierOverride === "number"
      ? multiplierOverride
      : state.boostUntil > Date.now()
        ? 2
        : 1;

    return {
      cupsPerMinute: cupsPerMinute,
      pricePerCup: pricePerCup,
      incomePerMinute: cupsPerMinute * pricePerCup * multiplier,
      incomePerSecond: cupsPerMinute * pricePerCup * multiplier / 60,
      servedPerSecond: cupsPerMinute / 60,
      capacity: 3 + seatsLevel * 2 + state.staff,
      multiplier: multiplier,
      boostActive: multiplier > 1
    };
  }

  function applyProduction(seconds, multiplier) {
    if (!state.isOpen || seconds <= 0) {
      return 0;
    }

    var economy = getEconomy(multiplier);
    var earnings = economy.incomePerSecond * seconds;
    var served = economy.servedPerSecond * seconds;

    state.coins += earnings;
    state.totalEarned += earnings;
    state.todayEarned += earnings;
    state.totalServed += served;
    state.todayServed += served;
    state.tipJar += served * 0.18;
    checkMilestones();
    return earnings;
  }

  var offlineEarnings = 0;
  var offlineSeconds = 0;

  if (savedState && savedState.lastSeen && state.isOpen) {
    offlineSeconds = Math.min(
      OFFLINE_CAP_SECONDS,
      Math.max(0, (Date.now() - Number(savedState.lastSeen)) / 1000)
    );
    state.boostUntil = 0;
    if (offlineSeconds > 15) {
      offlineEarnings = applyProduction(offlineSeconds * 0.86, 1);
    }
  }

  state.lastSeen = Date.now();

  function getShopLevel() {
    return 1 + Math.floor(state.totalServed / 50);
  }

  function getUpgradeCost(key) {
    var config = upgradeConfig[key];
    var level = Number(state.upgrades[key]) || 0;
    return Math.round(config.baseCost * Math.pow(config.costScale, level));
  }

  function getStaffCost() {
    return Math.round(260 * Math.pow(1.72, Math.max(0, state.staff - 1)));
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 0
    }).format(Math.max(0, Math.floor(value)));
  }

  function formatRate(value) {
    return new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }).format(Math.max(0, value));
  }

  function formatRelativeTime(timestamp) {
    var seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 1000));
    if (seconds < 20) {
      return "刚刚";
    }
    if (seconds < 60) {
      return seconds + " 秒前";
    }
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return minutes + " 分钟前";
    }
    return Math.floor(minutes / 60) + " 小时前";
  }

  function addActivity(message, icon, iconClass) {
    state.activities.unshift({
      icon: icon || "✦",
      iconClass: iconClass || "icon-bean",
      message: message,
      time: Date.now()
    });
    state.activities = state.activities.slice(0, 8);
  }

  function showToast(message, icon) {
    var stack = document.getElementById("toastStack");
    var toast = document.createElement("div");
    var iconNode = document.createElement("span");
    var messageNode = document.createElement("span");

    toast.className = "toast";
    iconNode.className = "toast-icon";
    iconNode.textContent = icon || "✦";
    messageNode.textContent = message;
    toast.appendChild(iconNode);
    toast.appendChild(messageNode);
    stack.appendChild(toast);

    window.setTimeout(function () {
      toast.classList.add("is-leaving");
      window.setTimeout(function () {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 240);
    }, 3200);
  }

  function checkMilestones() {
    var loggedTen = Math.floor(state.totalServed / 10);

    if (state.todayServed >= 50 && !state.goalReachedNotified) {
      state.goalReachedNotified = true;
      addActivity("今日目标完成了，柜台上多了一束小花。", "✿", "icon-bean");
      showToast("今日小目标完成！可以领取 ¥ 80 奖励", "✿");
    }

    if (loggedTen > state.lastLoggedTen && loggedTen % 2 === 0) {
      state.lastLoggedTen = loggedTen;
      addActivity("第 " + Math.floor(state.totalServed) + " 位客人满意离店。", "♡", "icon-heart");
    }
  }

  function saveState() {
    state.lastSeen = Date.now();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      // 本地存储不可用时，原型仍然可以在当前页面继续运行。
    }
    lastSaveAt = Date.now();
  }

  function renderActivities() {
    var list = document.getElementById("activityList");
    list.replaceChildren();

    state.activities.slice(0, 3).forEach(function (activity) {
      var item = document.createElement("li");
      var icon = document.createElement("span");
      var message = document.createElement("span");
      var time = document.createElement("time");

      icon.className = "activity-icon " + (activity.iconClass || "icon-bean");
      icon.textContent = activity.icon || "✦";
      message.textContent = activity.message;
      time.textContent = formatRelativeTime(activity.time);
      item.appendChild(icon);
      item.appendChild(message);
      item.appendChild(time);
      list.appendChild(item);
    });
  }

  function renderQueue(economy) {
    var container = document.getElementById("queueAvatars");
    var names = ["林", "苏", "陈", "周", "乔", "许", "叶"];
    var queueSize = Math.max(
      1,
      Math.min(9, Math.round(1 + economy.servedPerSecond * 6 + (state.upgrades.marketing || 0) * 0.55))
    );
    var visible = Math.min(3, queueSize);

    container.replaceChildren();
    for (var index = 0; index < visible; index += 1) {
      var avatar = document.createElement("span");
      avatar.textContent = names[index];
      container.appendChild(avatar);
    }
    if (queueSize > visible) {
      var more = document.createElement("span");
      more.className = "more-avatar";
      more.textContent = "+" + (queueSize - visible);
      container.appendChild(more);
    }
    container.setAttribute("aria-label", "当前排队 " + queueSize + " 位客人");
  }

  function renderScene(now) {
    var cycle = Math.floor(now / 2500);
    if (cycle === lastSceneCycle) {
      return;
    }
    lastSceneCycle = cycle;

    var customers = document.querySelectorAll(".customer");
    customers.forEach(function (customer, index) {
      var away = (cycle + index * 2) % 7 === 0;
      customer.classList.toggle("is-away", away);
    });
  }

  function renderMenu() {
    var recipeLevel = Number(state.upgrades.recipe) || 0;
    var unlockedCount = 0;
    var orderDrink = drinkConfig[orderState.drink];
    var selectedDrink = drinkConfig[state.selectedDrink];
    var matchingDrink = state.selectedDrink === orderState.drink;
    var brewSeconds = getDrinkBrewSeconds(orderState.drink);
    var remainingSeconds = Math.max(0, brewSeconds * (1 - orderState.progress));

    document.querySelectorAll("[data-drink]").forEach(function (card) {
      var key = card.getAttribute("data-drink");
      var unlocked = isDrinkUnlocked(key);
      var priceNode = card.querySelector("[data-price-for]");
      var unitNode = card.querySelector(".menu-price small");
      var lockNode = card.querySelector(".menu-locked-label");

      if (unlocked) {
        unlockedCount += 1;
      }
      card.classList.toggle("is-selected", unlocked && state.selectedDrink === key);
      card.classList.toggle("is-locked", !unlocked);
      card.setAttribute(
        "aria-label",
        unlocked
          ? drinkConfig[key].name + "，售价 ¥ " + formatMoney(getDrinkPrice(key))
          : drinkConfig[key].name + "，需要招牌配方 Lv. " + (drinkConfig[key].unlockAt + 1) + " 解锁"
      );
      priceNode.textContent = "¥ " + formatMoney(getDrinkPrice(key));
      priceNode.hidden = !unlocked;
      unitNode.hidden = !unlocked;
      lockNode.hidden = unlocked;
    });

    document.getElementById("manualOrderCount").textContent =
      "已服务 " + formatMoney(state.manualOrdersServed) + " 杯手作订单";
    document.getElementById("orderAvatar").textContent = orderState.avatar;
    document.getElementById("orderCustomer").textContent = orderState.customer;
    document.getElementById("orderMood").textContent = orderState.mood;
    document.getElementById("orderDrink").textContent = orderDrink.name;
    document.getElementById("orderPrice").textContent =
      "¥ " + formatMoney(getDrinkPrice(orderState.drink) + orderDrink.tip);
    document.getElementById("orderTimerLabel").textContent = orderState.isBrewing
      ? "剩余 " + remainingSeconds.toFixed(1) + " 秒"
      : "约 " + brewSeconds.toFixed(1) + " 秒";
    document.getElementById("brewProgress").style.width = (orderState.progress * 100) + "%";
    document.getElementById("brewProgressValue").textContent = Math.round(orderState.progress * 100) + "%";
    document.getElementById("brewProgressLabel").textContent = orderState.isBrewing
      ? "正在冲泡 " + orderDrink.name
      : "等待你的咖啡";

    var ticket = document.getElementById("orderTicketCard");
    var serveButton = document.getElementById("serveOrderButton");
    var serveLabel = document.getElementById("serveOrderLabel");
    ticket.classList.toggle("is-brewing", orderState.isBrewing);
    serveButton.disabled = !state.isOpen || orderState.isBrewing;

    if (!state.isOpen) {
      serveLabel.textContent = "重新开门后继续";
    } else if (orderState.isBrewing) {
      serveLabel.textContent = "咖啡正在变香";
    } else if (!matchingDrink) {
      serveLabel.textContent = "先选择 " + orderDrink.shortName;
    } else {
      serveLabel.textContent = "开始冲泡 · ¥ " + formatMoney(getDrinkPrice(orderState.drink) + orderDrink.tip);
    }

    document.getElementById("orderStatus").textContent = orderState.isBrewing
      ? "正在为 " + orderState.customer + " 冲泡"
      : matchingDrink
        ? orderState.customer + " 正在等你的 " + orderDrink.shortName
        : "选中 " + orderDrink.shortName + " 才能接单";
    document.getElementById("menuHint").textContent = !state.isOpen
      ? "店门暂时关闭，重新营业后可以继续手作订单。"
      : matchingDrink
        ? "匹配顾客点单，手作出杯会额外获得小费。"
        : "这位客人点的是 " + orderDrink.name + "，换一杯菜单再开始冲泡。";
    document.getElementById("recipeUnlockHint").textContent = unlockedCount === 3
      ? "三种风味都已解锁，今天想喝哪一杯？"
      : "升级招牌配方，解锁更多风味（" + unlockedCount + " / 3）";
  }

  function render(now) {
    var economy = getEconomy();
    var level = getShopLevel();
    var progress = Math.min(1, Math.max(0, (state.todayServed % 50) / 50));
    var goalCount = Math.min(50, Math.floor(state.todayServed));
    var boostSeconds = Math.max(0, Math.ceil((state.boostUntil - now) / 1000));
    var staffCost = getStaffCost();
    var upgradedCount = Object.keys(upgradeConfig).filter(function (key) {
      return Number(state.upgrades[key]) > 0;
    }).length;

    document.getElementById("coins").textContent = "¥ " + formatMoney(state.coins);
    document.getElementById("incomeRate").textContent = "¥ " + formatRate(economy.incomePerMinute) + " / 分钟";
    document.getElementById("todayRevenue").textContent = "¥ " + formatMoney(state.todayEarned);
    document.getElementById("todayServed").innerHTML = formatMoney(state.todayServed) + " <small>位</small>";
    document.getElementById("currentMultiplier").textContent = economy.multiplier.toFixed(1) + "×";
    document.getElementById("flowRate").textContent = formatRate(economy.cupsPerMinute);
    document.getElementById("shopLevel").textContent = "Lv. " + level;
    document.getElementById("upgradeCount").textContent = upgradedCount + " / 4";
    document.getElementById("staffCount").textContent = state.staff + " 位";
    document.getElementById("hireCost").textContent = "¥ " + formatMoney(staffCost);
    document.getElementById("hireStaffButton").disabled = state.coins < staffCost;
    document.getElementById("collectButton").textContent = "收取零钱 · ¥ " + formatMoney(state.tipJar);
    document.getElementById("collectButton").disabled = state.tipJar < 1;

    var status = document.getElementById("businessStatus");
    var statusLabel = document.getElementById("statusLabel");
    status.classList.toggle("is-closed", !state.isOpen);
    statusLabel.textContent = state.isOpen ? "营业中" : "已打烊";

    var boostButton = document.getElementById("boostButton");
    var boostLabel = document.getElementById("boostLabel");
    var boostHint = document.getElementById("boostHint");
    boostButton.classList.toggle("is-boosting", economy.boostActive);
    boostButton.disabled = economy.boostActive;
    if (economy.boostActive) {
      boostLabel.textContent = "加速中 · " + boostSeconds + " 秒";
      boostHint.textContent = "店内效率 ×2，香气全开";
    } else {
      boostLabel.textContent = "晨间加速";
      boostHint.textContent = "营业效率 ×2 · 15 秒";
    }

    document.getElementById("goalProgressText").textContent = goalCount + " / 50";
    document.getElementById("goalProgress").style.width = (progress * 100) + "%";
    var goalButton = document.getElementById("goalClaimButton");
    goalButton.disabled = state.goalClaimed || state.todayServed < 50;
    goalButton.innerHTML = state.goalClaimed
      ? "奖励已领取 <span>✓</span>"
      : "完成目标后领取奖励 <span>→</span>";

    var mood = document.getElementById("shopMood");
    var floorTip = document.getElementById("floorTip");
    if (!state.isOpen) {
      mood.textContent = "打烊后，咖啡香还在";
      floorTip.textContent = "明早再见，记得给植物浇水。";
    } else if (economy.boostActive) {
      mood.textContent = "晨间高峰正被你稳稳接住";
      floorTip.textContent = "加速中的每一秒，都在变成好生意。";
    } else if ((state.upgrades.marketing || 0) > 0) {
      mood.textContent = "街角的人流越来越多";
      floorTip.textContent = "好口碑正在沿着街区扩散。";
    } else {
      mood.textContent = "今天的空气很适合咖啡";
      floorTip.textContent = "升级设备，让香气走得更远。";
    }

    document.getElementById("shopScene").classList.toggle("is-boosting", economy.boostActive);
    renderQueue(economy);
    renderActivities();
    renderScene(now);
    renderMenu();

    Object.keys(upgradeConfig).forEach(function (key) {
      var cost = getUpgradeCost(key);
      var levelNode = document.querySelector('[data-level-for="' + key + '"]');
      var costNode = document.querySelector('[data-cost-for="' + key + '"]');
      var card = document.querySelector('[data-upgrade="' + key + '"]');

      levelNode.textContent = "Lv. " + (Number(state.upgrades[key]) + 1);
      costNode.textContent = "¥ " + formatMoney(cost);
      card.classList.toggle("is-unaffordable", state.coins < cost);
      card.setAttribute("aria-label", upgradeConfig[key].name + "，升级需要 ¥ " + formatMoney(cost));
    });
  }

  var lastTickAt = Date.now();
  var lastUiAt = 0;
  var lastSaveAt = Date.now();
  var lastSceneCycle = -1;

  function completeManualOrder() {
    var drink = drinkConfig[orderState.drink];
    var reward = getDrinkPrice(orderState.drink) + drink.tip;
    var customer = orderState.customer;

    state.coins += reward;
    state.totalEarned += reward;
    state.todayEarned += reward;
    state.totalServed += 1;
    state.todayServed += 1;
    state.tipJar += drink.tip;
    state.manualOrdersServed += 1;
    orderState.isBrewing = false;
    orderState.progress = 1;
    addActivity(customer + "满意地带走了你的 " + drink.name + "。", "☕", "icon-bean");
    showToast("订单完成，收入 ¥ " + formatMoney(reward) + "（含小费）", "☕");
    checkMilestones();
    createOrder();
    saveState();
    render(Date.now());
  }

  function updateOrderBrew(now) {
    if (!orderState.isBrewing || !state.isOpen) {
      return;
    }
    var duration = getDrinkBrewSeconds(orderState.drink) * 1000;
    orderState.progress = Math.min(1, (now - orderState.startedAt) / duration);
    if (orderState.progress >= 1) {
      completeManualOrder();
    }
  }

  document.querySelectorAll("[data-drink]").forEach(function (button) {
    button.addEventListener("click", function () {
      var key = button.getAttribute("data-drink");
      if (!isDrinkUnlocked(key)) {
        showToast(
          "升级招牌配方到 Lv. " + (drinkConfig[key].unlockAt + 1) + " 才能解锁 " + drinkConfig[key].name,
          "✧"
        );
        return;
      }
      if (state.selectedDrink === key) {
        return;
      }
      state.selectedDrink = key;
      addActivity("你把今日手作咖啡换成了 " + drinkConfig[key].name + "。", "✦", "icon-bean");
      saveState();
      render(Date.now());
    });
  });

  document.getElementById("serveOrderButton").addEventListener("click", function () {
    if (!state.isOpen || orderState.isBrewing) {
      return;
    }
    if (state.selectedDrink !== orderState.drink) {
      showToast("先选择客人点的 " + drinkConfig[orderState.drink].name + "。", "☕");
      return;
    }
    orderState.isBrewing = true;
    orderState.progress = 0;
    orderState.startedAt = Date.now();
    addActivity("开始为 " + orderState.customer + " 冲泡 " + drinkConfig[orderState.drink].name + "。", "☕", "icon-bean");
    showToast("冲泡开始，记得听一听咖啡机的声音。", "☕");
    render(Date.now());
  });

  document.querySelectorAll("[data-upgrade]").forEach(function (button) {
    button.addEventListener("click", function () {
      var key = button.getAttribute("data-upgrade");
      var config = upgradeConfig[key];
      var cost = getUpgradeCost(key);

      if (state.coins < cost) {
        showToast("还差 ¥ " + formatMoney(cost - state.coins) + "，再营业一会儿吧。", "☕");
        return;
      }

      state.coins -= cost;
      state.upgrades[key] = (Number(state.upgrades[key]) || 0) + 1;
      addActivity(config.name + "升级完成，" + config.effect + "提高了。", "✦", "icon-bean");
      showToast(config.name + "已升级到 Lv. " + (state.upgrades[key] + 1), "✦");
      saveState();
      render(Date.now());
    });
  });

  document.getElementById("boostButton").addEventListener("click", function () {
    if (state.boostUntil > Date.now()) {
      return;
    }
    state.boostUntil = Date.now() + 15000;
    addActivity("晨间加速启动，今天的第一缕香气更快了。", "✦", "icon-bean");
    showToast("晨间加速已启动，效率 ×2 持续 15 秒", "✦");
    render(Date.now());
  });

  document.getElementById("collectButton").addEventListener("click", function () {
    var amount = Math.floor(state.tipJar);
    if (amount < 1) {
      showToast("零钱罐还在慢慢积攒中。", "♡");
      return;
    }
    state.coins += amount;
    state.tipJar -= amount;
    addActivity("你收取了客人留下的 ¥ " + formatMoney(amount) + " 小费。", "♡", "icon-heart");
    showToast("零钱已入账：¥ " + formatMoney(amount), "♡");
    saveState();
    render(Date.now());
  });

  document.getElementById("hireStaffButton").addEventListener("click", function () {
    var cost = getStaffCost();
    if (state.coins < cost) {
      showToast("还差 ¥ " + formatMoney(cost - state.coins) + "，暂时还不能招募。", "☕");
      return;
    }
    state.coins -= cost;
    state.staff += 1;
    addActivity("新的咖啡师加入了 Mellow Bean。", "✦", "icon-bean");
    showToast("欢迎新伙伴加入！店铺效率提高了。", "✦");
    saveState();
    render(Date.now());
  });

  document.getElementById("goalClaimButton").addEventListener("click", function () {
    if (state.goalClaimed || state.todayServed < 50) {
      return;
    }
    state.goalClaimed = true;
    state.coins += 80;
    addActivity("你领取了今日小目标奖励 ¥ 80。", "✿", "icon-bean");
    showToast("奖励已领取：¥ 80", "✿");
    saveState();
    render(Date.now());
  });

  document.getElementById("businessStatus").addEventListener("click", function () {
    state.isOpen = !state.isOpen;
    if (state.isOpen) {
      addActivity("店门重新打开，第一位客人已经在门口微笑。", "☼", "icon-sun");
      showToast("重新开门营业", "☼");
    } else {
      addActivity("今天先打烊一会儿，给自己留一点空白。", "☾", "icon-sun");
      showToast("已打烊，自动收益暂停", "☾");
    }
    saveState();
    render(Date.now());
  });

  document.getElementById("resetButton").addEventListener("click", function () {
    var confirmed = window.confirm("要清除 Mellow Bean 在这台设备上的原型进度吗？");
    if (!confirmed) {
      return;
    }
    state = createDefaultState();
    offlineEarnings = 0;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // 忽略不可用的本地存储。
    }
    addActivity("新的一天，从一杯好咖啡开始。", "✦", "icon-bean");
    showToast("进度已重置，欢迎回到 Mellow Bean。", "↺");
    saveState();
    render(Date.now());
  });

  document.getElementById("offlineDismiss").addEventListener("click", function () {
    document.getElementById("offlineNotice").hidden = true;
  });

  function showOfflineNotice() {
    if (offlineEarnings < 1) {
      return;
    }
    document.getElementById("offlineAmount").textContent = "¥ " + formatMoney(offlineEarnings);
    document.getElementById("offlineNotice").hidden = false;
    showToast("欢迎回来，离线收益已入账。", "☼");
  }

  function gameLoop() {
    var now = Date.now();
    var seconds = Math.max(0, Math.min(3, (now - lastTickAt) / 1000));
    var economy = getEconomy();

    updateOrderBrew(now);
    if (state.isOpen && seconds > 0) {
      applyProduction(seconds, economy.multiplier);
    }
    lastTickAt = now;

    if (now - lastUiAt > 250) {
      render(now);
      lastUiAt = now;
    }
    if (now - lastSaveAt > 5000) {
      saveState();
    }
    window.requestAnimationFrame(gameLoop);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      saveState();
      lastTickAt = Date.now();
      return;
    }

    var now = Date.now();
    var gap = Math.min(OFFLINE_CAP_SECONDS, Math.max(0, (now - lastTickAt) / 1000));
    state.boostUntil = 0;
    if (gap > 15 && state.isOpen) {
      var resumedEarnings = applyProduction(gap * 0.86, 1);
      if (resumedEarnings > 1) {
        showToast("你离开期间，店里赚了 ¥ " + formatMoney(resumedEarnings), "☼");
      }
    }
    lastTickAt = now;
    render(now);
  });

  window.addEventListener("beforeunload", saveState);

  saveState();
  render(Date.now());
  window.setTimeout(showOfflineNotice, 350);
  window.requestAnimationFrame(gameLoop);
})();
