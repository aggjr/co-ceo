/**
 * Janela temporal para gráficos e cargas (delega ao núcleo canônico `lib/mira_model.js`).
 *
 * Uso (Node): const { filterTimelineChartWindow } = require('./timeline_window');
 */

const {
  weekday,
  clampToLastNonSunday,
  filterTimelineChartWindow,
} = require("./lib/mira_model");

module.exports = {
  weekday,
  clampToLastNonSunday,
  filterTimelineChartWindow,
};
