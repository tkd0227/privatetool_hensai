"use strict";

const COLORS = ["#287a57", "#d17a32", "#5276b5", "#9a64a8", "#4e9991"];
const MAX_ACCOUNTS = 5;
const MAX_PROJECTION_MONTHS = 600;
const MAX_INPUT_AMOUNT = 1_000_000_000;
const accountList = document.querySelector("#account-list");
const resultsContent = document.querySelector("#results-content");
const formError = document.querySelector("#form-error");
const targetSummary = document.querySelector("#target-summary");
const accounts = [];
const currentMonth = monthValue(new Date());
let lastSubmittedAccounts = null;
let planChangedSinceSubmit = false;

function monthValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(value, count) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + count, 1);
  return monthValue(date);
}

function monthsBetween(from, to) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + toMonth - fromMonth;
}

function formatMonth(value) {
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

function formatYen(value) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function createField(labelText, inputType, value, unit, min, max, step = "1") {
  const label = document.createElement("label");
  label.className = "field";
  const caption = document.createElement("span");
  caption.textContent = labelText;
  const wrapper = document.createElement("span");
  wrapper.className = "unit-input";
  const input = document.createElement("input");
  input.type = inputType;
  input.value = value;
  input.min = min;
  input.max = max;
  input.step = step;
  input.required = true;
  input.inputMode = inputType === "number" ? "decimal" : undefined;
  input.setAttribute("aria-label", labelText);
  const suffix = document.createElement("span");
  suffix.className = "unit";
  suffix.textContent = unit;
  wrapper.append(input, suffix);
  label.append(caption, wrapper);
  return { label, input };
}

function createOptionalMonthField(labelText, value) {
  const label = document.createElement("label");
  label.className = "field";
  const caption = document.createElement("span");
  caption.textContent = `${labelText}（任意）`;
  const input = document.createElement("input");
  input.type = "month";
  input.value = value;
  input.setAttribute("aria-label", `${labelText}（任意）`);
  label.append(caption, input);
  return { label, input };
}

function renderAccountCard(account, index) {
  const card = document.createElement("article");
  card.className = "account-card";
  card.dataset.accountId = account.id;

  const heading = document.createElement("div");
  heading.className = "account-card-heading";
  const titleWrap = document.createElement("div");
  titleWrap.className = "account-title-wrap";
  const swatch = document.createElement("span");
  swatch.className = "account-swatch";
  swatch.style.backgroundColor = COLORS[index];
  swatch.setAttribute("aria-hidden", "true");
  const name = document.createElement("input");
  name.className = "account-name";
  name.value = account.name;
  name.maxLength = 40;
  name.setAttribute("aria-label", `借入先${index + 1}の名前`);
  name.addEventListener("input", () => {
    account.name = name.value;
    markPlanChanged();
  });
  titleWrap.append(swatch, name);

  const remove = document.createElement("button");
  remove.className = "button button-remove";
  remove.type = "button";
  remove.textContent = "削除";
  remove.setAttribute("aria-label", `${account.name || `借入先${index + 1}`}を削除`);
  remove.addEventListener("click", () => {
    const accountIndex = accounts.findIndex((item) => item.id === account.id);
    if (accountIndex !== -1) accounts.splice(accountIndex, 1);
    renderAccounts();
    markPlanChanged();
  });
  heading.append(titleWrap, remove);

  const fields = document.createElement("div");
  fields.className = "account-fields";
  const fieldDefinitions = [
    ["現在の元金残高", "number", account.balance, "円", "1", String(MAX_INPUT_AMOUNT), "1", "balance"],
    ["年利", "number", account.apr, "%", "0", "100", "0.01", "apr"],
    ["毎月の定額返済額（利息込み）", "number", account.payment, "円", "0", String(MAX_INPUT_AMOUNT), "1", "payment"],
    ["毎月の追加返済額", "number", account.extra, "円", "0", String(MAX_INPUT_AMOUNT), "1", "extra"],
  ];
  for (const [label, type, value, unit, min, max, step, key] of fieldDefinitions) {
    const field = createField(label, type, value, unit, min, max, step);
    field.input.addEventListener("input", () => {
      account[key] = field.input.value;
      markPlanChanged();
    });
    fields.append(field.label);
  }

  for (const [label, key] of [["返済開始月", "startMonth"], ["完済目標月", "targetMonth"]]) {
    const field = createOptionalMonthField(label, account[key]);
    field.input.addEventListener("input", () => {
      account[key] = field.input.value;
      markPlanChanged();
    });
    fields.append(field.label);
  }

  card.append(heading, fields);
  return card;
}

function renderAccounts() {
  accountList.replaceChildren(...accounts.map(renderAccountCard));
  document.querySelector("#add-account").disabled = accounts.length >= MAX_ACCOUNTS;
  document.querySelector("#add-account").textContent =
    accounts.length >= MAX_ACCOUNTS ? "最大5件まで" : "＋ 借入先を追加";
}

function parseAccount(account) {
  if ([account.balance, account.apr, account.payment, account.extra].some((value) => String(value).trim() === "")) {
    return null;
  }
  const balance = Number(account.balance);
  const apr = Number(account.apr);
  const payment = Number(account.payment);
  const extra = Number(account.extra);
  if (![balance, apr, payment, extra].every(Number.isFinite)) return null;
  if (balance <= 0 || balance > MAX_INPUT_AMOUNT || apr < 0 || apr > 100) return null;
  if (payment < 0 || payment > MAX_INPUT_AMOUNT || extra < 0 || extra > MAX_INPUT_AMOUNT) return null;
  return { balance, apr, payment, extra };
}

function calculateSchedule(account, extra, maxMonths = MAX_PROJECTION_MONTHS) {
  let balance = account.balance;
  let totalInterest = 0;
  const rows = [{ balance, interest: 0, payment: 0, principal: 0 }];
  for (let month = 1; month <= maxMonths && balance > 0; month += 1) {
    const interest = Math.round((balance * account.apr) / 100 / 12);
    const amountDue = balance + interest;
    const payment = Math.min(amountDue, account.payment + extra);
    const interestPaid = Math.min(interest, payment);
    const principalPaid = Math.min(balance, Math.max(0, payment - interestPaid));
    balance = Math.max(0, amountDue - payment);
    totalInterest += interest;
    rows.push({ balance, interest, interestPaid, payment, principal: principalPaid });
  }
  return {
    rows,
    totalInterest,
    payoffMonth: balance === 0 ? rows.length - 1 : null,
  };
}

function requiredExtra(account, months) {
  if (calculateSchedule(account, 0, months).payoffMonth !== null) return 0;
  let low = 1;
  let high = account.balance + Math.ceil((account.balance * account.apr) / 1200) + 1;
  while (calculateSchedule(account, high, months).payoffMonth === null) {
    high *= 2;
    if (high > MAX_INPUT_AMOUNT * 100) return null;
  }
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calculateSchedule(account, middle, months).payoffMonth !== null) high = middle;
    else low = middle + 1;
  }
  return low;
}

function getStartMonth(account) {
  return account.startMonth || currentMonth;
}

function validatePlan() {
  if (accounts.length === 0) return "借入先を1件以上追加してください。";
  const parsed = accounts.map(parseAccount);
  if (parsed.some((account) => account === null)) {
    return "元金残高は1円以上、年利は0〜100%、返済額は0円以上で入力してください。";
  }
  for (const account of accounts) {
    if (!account.targetMonth) continue;
    const monthCount = monthsBetween(getStartMonth(account), account.targetMonth) + 1;
    if (monthCount < 1) return `${account.name || "借入先"}の完済目標月は返済開始月以降に設定してください。`;
    if (monthCount > MAX_PROJECTION_MONTHS) return `${account.name || "借入先"}の完済目標月は返済開始月から50年以内に設定してください。`;
  }
  return "";
}

function createSummaryCard(account, index, schedule, neededExtra, startMonth, targetMonths) {
  const card = document.createElement("article");
  card.className = "summary-card";
  const top = document.createElement("div");
  top.className = "summary-card-top";
  const swatch = document.createElement("span");
  swatch.className = "account-swatch";
  swatch.style.backgroundColor = COLORS[index];
  const name = document.createElement("span");
  name.textContent = account.name.trim() || `借入先${index + 1}`;
  top.append(swatch, name);

  const values = document.createElement("div");
  values.className = "summary-values";
  const details = [
    ["現在の元金", formatYen(account.balance)],
    ["今後の利息見込み", schedule.payoffMonth === null ? "50年以上" : formatYen(schedule.totalInterest)],
  ];
  for (const [label, value] of details) {
    const item = document.createElement("div");
    const itemLabel = document.createElement("span");
    itemLabel.className = "summary-label";
    itemLabel.textContent = label;
    const itemValue = document.createElement("span");
    itemValue.className = "summary-value";
    itemValue.textContent = value;
    item.append(itemLabel, itemValue);
    values.append(item);
  }

  const dateMeta = document.createElement("span");
  dateMeta.className = "summary-meta";
  dateMeta.textContent = `開始：${account.startMonth ? formatMonth(startMonth) : "今月（未設定）"} ・ 目標：${account.targetMonth ? formatMonth(account.targetMonth) : "なし"}`;

  const meta = document.createElement("span");
  meta.className = "summary-meta";
  if (schedule.payoffMonth === null) {
    meta.classList.add("status-bad");
    meta.textContent = "現在の返済設定では50年以内に完済できません。定額返済額または追加返済額を見直してください。";
  } else {
    const payoffDate = addMonths(startMonth, schedule.payoffMonth - 1);
    meta.textContent = `完済見込み：${formatMonth(payoffDate)} ・ 返済総額：${formatYen(account.balance + schedule.totalInterest)}`;
    if (targetMonths !== null) {
      if (neededExtra === null) {
        meta.classList.add("status-bad");
        meta.textContent += " ・ 目標月の必要額を計算できません";
      } else if (account.extra >= neededExtra) {
        meta.classList.add("status-good");
        meta.textContent += ` ・ 目標月に間に合う設定です（必要な追加返済：${formatYen(neededExtra)}/月）`;
      } else {
        meta.classList.add("status-warn");
        meta.textContent += ` ・ 目標月まであと${formatYen(neededExtra - account.extra)}/月の追加が必要`;
      }
    }
  }
  card.append(top, values, dateMeta, meta);
  return card;
}

function createScheduleDetails(account, index, schedule, startMonth) {
  const details = document.createElement("details");
  details.className = "schedule-item";
  const summary = document.createElement("summary");
  const name = document.createElement("span");
  name.className = "schedule-name";
  const swatch = document.createElement("span");
  swatch.className = "account-swatch";
  swatch.style.backgroundColor = COLORS[index];
  const label = document.createElement("span");
  label.textContent = account.name.trim() || `借入先${index + 1}`;
  name.append(swatch, label);
  const caption = document.createElement("span");
  caption.className = "schedule-caption";
  caption.textContent = `定額 ${formatYen(account.payment)}（利息込み）＋ 追加 ${formatYen(account.extra)}/月`;
  summary.append(name, caption);
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "schedule-table";
  table.innerHTML = "<thead><tr><th>月</th><th>返済前元金</th><th>発生利息</th><th>返済額</th><th>元金返済分</th><th>返済後元金</th></tr></thead>";
  const body = document.createElement("tbody");
  schedule.rows.forEach((row, month) => {
    if (month === 0) return;
    const tr = document.createElement("tr");
    const values = [
      formatMonth(addMonths(startMonth, month - 1)),
      formatYen(schedule.rows[month - 1].balance),
      formatYen(row.interest),
      formatYen(row.payment),
      formatYen(row.principal),
      formatYen(row.balance),
    ];
    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  });
  table.append(body);
  tableWrap.append(table);
  details.append(summary, tableWrap);
  return details;
}

function drawChart(series, maxBalance) {
  const canvas = document.querySelector("#balance-chart");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  const left = width < 500 ? 62 : 76;
  const right = 14;
  const top = 15;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxMonths = Math.max(1, ...series.map((item) => item.schedule.rows.length - 1));
  const upperBound = Math.max(1, Math.ceil(maxBalance / 1000) * 1000);

  ctx.font = '10px "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif';
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#e9efeb";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#829087";
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (upperBound * tick) / 4;
    const y = top + chartHeight - (chartHeight * tick) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    const label = value >= 10000 ? `${(value / 10000).toLocaleString("ja-JP")}万` : `${Math.round(value).toLocaleString("ja-JP")}`;
    ctx.textAlign = "right";
    ctx.fillText(label, left - 8, y);
  }

  for (let tick = 0; tick <= 4; tick += 1) {
    const month = Math.round((maxMonths * tick) / 4);
    const x = left + (chartWidth * tick) / 4;
    ctx.textAlign = tick === 0 ? "left" : tick === 4 ? "right" : "center";
    ctx.fillStyle = "#829087";
    ctx.fillText(`${month}か月`, x, height - 12);
  }

  series.forEach(({ account, index, schedule }) => {
    const rows = schedule.rows;
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = COLORS[index];
    rows.forEach((row, month) => {
      const x = left + (chartWidth * month) / maxMonths;
      const y = top + chartHeight - (chartHeight * row.balance) / upperBound;
      if (month === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (rows.length - 1 < maxMonths) {
      const x = left + (chartWidth * (rows.length - 1)) / maxMonths;
      const y = top + chartHeight;
      ctx.lineTo(left + chartWidth, y);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

function renderResults(parsedAccounts) {
  const series = parsedAccounts.map((account, index) => {
    const startMonth = getStartMonth(account);
    const accountTargetMonths = account.targetMonth
      ? monthsBetween(startMonth, account.targetMonth) + 1
      : null;
    const schedule = calculateSchedule(account, account.extra);
    const neededExtra = accountTargetMonths === null ? null : requiredExtra(account, accountTargetMonths);
    return { account, index, schedule, neededExtra, startMonth, targetMonths: accountTargetMonths };
  });

  const content = document.createElement("div");
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart-wrap";
  const canvas = document.createElement("canvas");
  canvas.id = "balance-chart";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "借入先ごとの月別元金残高の推移を示すグラフ");
  chartWrap.append(canvas);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  series.forEach(({ account, index }) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    const line = document.createElement("span");
    line.className = "legend-line";
    line.style.backgroundColor = COLORS[index];
    const label = document.createElement("span");
    label.textContent = account.name.trim() || `借入先${index + 1}`;
    item.append(line, label);
    legend.append(item);
  });

  const cards = document.createElement("div");
  cards.className = "summary-grid";
  series.forEach(({ account, index, schedule, neededExtra, startMonth, targetMonths }) => {
    cards.append(createSummaryCard(account, index, schedule, neededExtra, startMonth, targetMonths));
  });

  const detailsHeading = document.createElement("h3");
  detailsHeading.className = "details-heading";
  detailsHeading.textContent = "月ごとの返済内訳";
  const scheduleList = document.createElement("div");
  scheduleList.className = "schedule-list";
  series.forEach(({ account, index, schedule, startMonth }) => {
    scheduleList.append(createScheduleDetails(account, index, schedule, startMonth));
  });

  content.append(chartWrap, legend, cards, detailsHeading, scheduleList);
  resultsContent.replaceChildren(content);
  updateTargetSummary();
  const maxBalance = Math.max(...parsedAccounts.map((account) => account.balance));
  requestAnimationFrame(() => drawChart(series, maxBalance));
}

function updateResults() {
  const error = validatePlan();
  formError.hidden = !error;
  formError.textContent = error;
  if (error) {
    resultsContent.innerHTML = '<div class="empty-state">入力内容を確認してください。</div>';
    lastSubmittedAccounts = null;
    planChangedSinceSubmit = false;
    targetSummary.textContent = "";
    return;
  }
  lastSubmittedAccounts = accounts.map((account) => ({
    ...account,
    ...parseAccount(account),
  }));
  planChangedSinceSubmit = false;
  renderResults(lastSubmittedAccounts);
}

function updateTargetSummary() {
  targetSummary.textContent = planChangedSinceSubmit
    ? "入力内容が未反映です。「返済の見通しを立てる」を押して更新してください。"
    : "開始月は借入先ごと（未設定は今月から試算）";
}

function markPlanChanged() {
  planChangedSinceSubmit = true;
  if (lastSubmittedAccounts) {
    updateTargetSummary();
  }
}

document.querySelector("#add-account").addEventListener("click", () => {
  if (accounts.length >= MAX_ACCOUNTS) return;
  accounts.push({
    id: `account-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: `借入先${accounts.length + 1}`,
    balance: "",
    apr: "",
    payment: "",
    extra: "0",
    startMonth: "",
    targetMonth: "",
  });
  renderAccounts();
  markPlanChanged();
  accountList.lastElementChild?.querySelector('input[type="number"]')?.focus();
});

document.querySelector("#calculate-plan").addEventListener("click", updateResults);

window.addEventListener("resize", () => {
  if (lastSubmittedAccounts) renderResults(lastSubmittedAccounts);
});

accounts.push({
  id: "account-example",
  name: "借入先1",
  balance: "500000",
  apr: "15",
  payment: "20000",
  extra: "0",
  startMonth: "",
  targetMonth: "",
});
renderAccounts();
