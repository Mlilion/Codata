# echarts 图表规范（动态交互）

报告里的图表用 echarts（CDN）+ 内联数据 生成，浅色主题，与 Codata app 观感一致。图表要能交互（hover tooltip、legend 开关）。

## 1. 引入 echarts（CDN）

在 `<head>` 引入固定版本：

```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
```

这是本报告唯一允许的外部资源。图表渲染需要网络；离线时按第 6 节做兜底。

## 2. 数据内联

查询结果作为 JS 数组/对象内联进 `<body>` 末尾的 `<script>`，不要联网取数（延续数据快照原则）。例如：

```js
const dates = ["06-07","06-08"];
const cost  = [56149, 55170];
const rev   = [4558, 4036];
```

## 3. 浅色主题（必须——不要用深色）

所有图表用浅色配置。定义一次、各图复用：

```js
const axisStyle = {
  axisLine:  { lineStyle: { color: "#e5e7eb" } },
  axisLabel: { color: "#6b7280" },
  splitLine: { lineStyle: { color: "#eceff3" } },
};
const baseOption = {
  backgroundColor: "transparent",
  textStyle: { color: "#6b7280" },
  tooltip: { trigger: "axis" },
  grid: { left: 56, right: 24, top: 40, bottom: 40 },
};
```

标题、图例文字色用 `#111827`（主）/`#6b7280`（次）。不要深色底、不要 `#0d1117` 这类深色值。

## 4. series 配色（沿用 chart-renderer 8 色板）

按顺序取色，第 i 个 series 用第 `i % 8` 个：

```
#4f8ff7  #f79f4f  #4fcf8f  #c77dff  #f7746f  #4fc4cf  #f7c14f  #8f9ff7
```

首色 `#4f8ff7` 作主色（单 series 图默认用它）。

## 5. 图表类型与交互

- 时间序列 → `line`（可 `smooth: true`、`areaStyle` 做面积）
- 分类对比 → `bar`
- 双指标不同量级 → 双 `yAxis` + bar(左轴)/line(右轴)，用 `yAxisIndex`
- 结构对比 → `stack` 堆叠 bar
- 占比 → `pie`（环形 `radius: ['40%','65%']`）
- 强调点/异常 → `markPoint` / `markLine`（如均值线、数据缺口标注）

echarts 默认带 hover tooltip 和 legend 点击开关——保留，不要关掉。

数字格式化（与 chart-renderer 一致）：轴刻度紧凑（≥1e6 → `X.XM`、≥1e4 → `XK`、否则千分位）；tooltip 用完整千分位。可用 `axisLabel.formatter` / `tooltip.formatter` 实现。

类目过多（>50）先聚合再画。

## 6. 每个图的 HTML + 初始化

图表区放固定高度的容器 `<div>`，`<script>` 里 `echarts.init(...).setOption(...)`。容器内先放离线兜底文案，echarts init 成功会覆盖它：

```html
<div class="chart-block">
  <div id="chart-trend" class="chart" style="height:380px;">
    <div class="chart-fallback">图表需要网络加载 echarts，如未显示请检查网络连接。</div>
  </div>
  <div class="chart-caption">图注/口径说明</div>
</div>
```

```js
if (window.echarts) {
  echarts.init(document.getElementById("chart-trend")).setOption({
    ...baseOption,
    legend: { data: ["消耗","收入"], top: 0, textStyle: { color: "#6b7280" } },
    xAxis: { type: "category", data: dates, ...axisStyle },
    yAxis: [{ type: "value", ...axisStyle }, { type: "value", ...axisStyle }],
    series: [
      { name: "消耗", type: "bar",  data: cost, itemStyle: { color: "#4f8ff7" } },
      { name: "收入", type: "line", yAxisIndex: 1, data: rev, smooth: true, itemStyle: { color: "#4fcf8f" } },
    ],
  });
}
```

（`if (window.echarts)` 保证 CDN 没加载时不报错、兜底文案保留。）

## 7. 配置模板速查

- line（趋势）：`series: [{ type:"line", data, smooth:true, itemStyle:{color:"#4f8ff7"}, areaStyle:{color:"#4f8ff722"} }]`
- bar（对比）：`series: [{ type:"bar", data, itemStyle:{color:"#4f8ff7"} }]`
- stacked bar（结构）：多个 `{ type:"bar", stack:"g", data, itemStyle:{color:<第i色>} }`
- pie（占比）：`series: [{ type:"pie", radius:['40%','65%'], data:[{name,value,itemStyle:{color:<第i色>}}], label:{formatter:'{b} {d}%'} }]`，`tooltip:{trigger:'item'}`
- 双轴：`yAxis:[{...},{...}]` + series 用 `yAxisIndex:0/1`
- 均值/缺口标注：`markLine:{data:[{yAxis:均值}]}` / `markPoint:{data:[{coord:[x,0],value:'缺口'}]}`

## 8. 自检

- [ ] `<head>` 有 echarts CDN，且是唯一外部资源？
- [ ] 数据内联、不联网取数？
- [ ] 浅色主题（透明底、浅色轴线/网格）、配色用 8 色板？
- [ ] 每个图容器有离线兜底文案、`if (window.echarts)` 守卫？
- [ ] tooltip / legend 交互保留？
- [ ] 数字格式化：轴紧凑、tooltip 千分位？
