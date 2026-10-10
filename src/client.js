/**
 * dsh-model-balance —— client 半边（浏览器插件）。
 *
 * 装配契约（DSH 浏览器侧）：本文件是**单文件副作用脚本**，加载时调用
 * `window.__ModuleLoader__.load({ id, factory })`；`factory(require)` 的 require 只认平台
 * 种子模块（react / react-dom / @deepseek-ai/*），**不能用相对 import**。
 * 因此共享的计价内核由构建内联进来（见下方 <<<INLINE>>> 占位与 scripts/build-client.js）。
 *
 * 职责边界：
 * - 展示层**不认识任何计价规则**：时段/单价都是 host 经 /state 带出来的数据；
 * - 「距下次切换」倒计时在**本地每秒**算（纯函数 peakValleyAt），不产生任何网络请求；
 * - 余额只有一个来源：GET /state（host 侧统一查、统一写）。展示层从不自己查外部接口。
 */
(function () {
  'use strict';

  // ==========================================================================
  // 内联：共享计价内核（构建时替换本行；保证算法只有一份实现）
  // <<<INLINE:src/shared/pricing.js>>>
  // ==========================================================================

  var NAME = 'dsh-model-balance';
  var NS = 'dsh-model-balance';
  var ROUTE = '/dsh-model-balance';
  /** 余额状态轮询间隔（ms）。余额是慢变量，10s 足够；倒计时不走这条通道。 */
  var POLL_MS = 10000;
  /** 倒计时重算间隔（ms）：纯本地计算，无请求成本 */
  var TICK_MS = 1000;
  /** 本地服务请求超时（ms） */
  var REQUEST_TIMEOUT_MS = 15000;
  /** CSS 去重标记（与 dsh-pet 同一套 data-plugin-css 约定） */
  var CSS_FLAG = 'dsh-model-balance-css';
  /** 槽位 id（overlay 与 sidebar 都用它，切位时不会同时出现两个） */
  var ENTRY_ID = 'model-balance';

  /** 中文字典（默认语言） */
  var DICT_ZH = {
    title: '模型余额',
    'tier.peak': '高峰',
    'tier.idle': '低谷',
    loading: '查询中…',
    'countdown.to': '距{tier} {time}',
    'weekend.idle': '周末全天低谷',
    'reason.transport': '本地服务未就绪',
    'reason.unsupported': '当前服务未登记余额接口',
    'reason.credentialMissing': '缺少凭证',
    'reason.fetchError': '余额查询失败',
    'panel.source': '数据源',
    'panel.total': '总可用',
    'panel.granted': '赠金',
    'panel.toppedUp': '充值',
    'panel.window': '计费时段',
    'panel.windowValue': '工作日 09:00–12:00、14:00–18:00；周末全天低谷',
    'panel.next': '下次切换',
    'panel.nextWeekend': '{day} 09:00 进入高峰',
    'panel.prices': '单价（每百万 tokens）',
    'panel.pricePeak': '高峰',
    'panel.priceIdle': '低谷',
    'panel.updated': '更新于',
    'panel.hint': '点击立即刷新',
    'panel.never': '尚未取到数据',
  };

  /** 英文字典 */
  var DICT_EN = {
    title: 'Model balance',
    'tier.peak': 'Peak',
    'tier.idle': 'Off-peak',
    loading: 'Loading…',
    'countdown.to': '{time} to {tier}',
    'weekend.idle': 'Off-peak all weekend',
    'reason.transport': 'Local service unavailable',
    'reason.unsupported': 'No balance API for this provider',
    'reason.credentialMissing': 'Credential missing',
    'reason.fetchError': 'Balance query failed',
    'panel.source': 'Source',
    'panel.total': 'Total available',
    'panel.granted': 'Granted',
    'panel.toppedUp': 'Topped up',
    'panel.window': 'Pricing windows',
    'panel.windowValue': 'Weekdays 09:00–12:00, 14:00–18:00; off-peak all weekend',
    'panel.next': 'Next switch',
    'panel.nextWeekend': 'Peak resumes {day} 09:00',
    'panel.prices': 'Unit price (per million tokens)',
    'panel.pricePeak': 'Peak',
    'panel.priceIdle': 'Off-peak',
    'panel.updated': 'Updated',
    'panel.hint': 'Click to refresh',
    'panel.never': 'No data yet',
  };

  /** 样式：颜色一律走主题 token（token 自带明暗两套值，故明暗主题自动适配） */
  var CSS = [
    '.dshmb-root{position:fixed;right:14px;bottom:14px;z-index:40;display:flex;justify-content:flex-end;pointer-events:none}',
    '.dshmb-root.is-sidebar{position:static;right:auto;bottom:auto;width:100%;padding:4px 6px 2px}',
    '.dshmb-badge{pointer-events:auto;position:relative;display:inline-flex;align-items:center;gap:8px;',
    'padding:6px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);',
    'color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.2;font-variant-numeric:tabular-nums;',
    'box-shadow:0 2px 10px rgba(0,0,0,.12);cursor:pointer;user-select:none;max-width:min(72vw,320px)}',
    '.dshmb-badge:hover{border-color:var(--dsw-alias-border-l2)}',
    '.dshmb-badge:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
    '.dshmb-money{font-weight:600}',
    '.dshmb-tier{padding:1px 6px;border-radius:999px;border:1px solid currentColor;font-size:11px;white-space:nowrap}',
    '.dshmb-tier-peak{color:var(--dsw-alias-state-warn-primary)}',
    '.dshmb-tier-idle{color:var(--dsw-alias-state-success-primary)}',
    '.dshmb-count,.dshmb-reason{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
    '.dshmb-reason-error{color:var(--dsw-alias-state-error-primary)}',
    '.dshmb-panel{pointer-events:auto;position:absolute;right:0;bottom:calc(100% + 8px);min-width:230px;max-width:min(86vw,340px);',
    'padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);',
    'color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:12px;line-height:1.5;text-align:left}',
    '.dshmb-root.is-sidebar .dshmb-panel{right:auto;left:0}',
    '.dshmb-panel-title{font-weight:600;margin-bottom:6px}',
    '.dshmb-row{display:flex;justify-content:space-between;gap:16px}',
    '.dshmb-row+.dshmb-row{margin-top:4px}',
    '.dshmb-row-key{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
    '.dshmb-row-val{text-align:right;word-break:break-word}',
    '.dshmb-sep{margin:8px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
    '.dshmb-hint{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:11px}',
  ].join('');

  /** 注入样式（只注一次） */
  function injectCss() {
    if (document.querySelector('style[data-plugin-css="' + CSS_FLAG + '"]') !== null) return;
    var style = document.createElement('style');
    style.setAttribute('data-plugin-css', CSS_FLAG);
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /** 极简订阅存储：状态只有一个来源（/state 轮询），组件只订阅不自己拉 */
  function createStore() {
    var snapshot = { state: null, error: null, at: 0 };
    var listeners = [];
    return {
      read: function () {
        return snapshot;
      },
      write: function (next) {
        snapshot = next;
        listeners.slice().forEach(function (listener) {
          listener();
        });
      },
      subscribe: function (listener) {
        listeners.push(listener);
        return function () {
          var index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    };
  }

  /** 带超时的本地请求 */
  function request(path, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller !== null) controller.abort();
    }, REQUEST_TIMEOUT_MS);
    var init = Object.assign({ cache: 'no-store' }, options || {});
    if (controller !== null) init.signal = controller.signal;
    return fetch(ROUTE + path, init).then(
      function (response) {
        clearTimeout(timer);
        return response;
      },
      function (error) {
        clearTimeout(timer);
        throw error;
      },
    );
  }

  /** 星期文案（用于「周一 09:00 进入高峰」） */
  function weekdayLabel(epochMs, timeZone, locale) {
    var names = locale === 'en'
      ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var short = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, weekday: 'short' }).format(new Date(epochMs));
    var index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
    return index >= 0 ? names[index] : '';
  }

  /** 失败原因 → 可读文案（reason 语义见 types/index.d.ts） */
  function reasonText(balance, t) {
    if (balance.reason === 'unsupported') return t('reason.unsupported');
    if (balance.reason === 'credential-missing') {
      return balance.message ? t('reason.credentialMissing') + '：' + balance.message : t('reason.credentialMissing');
    }
    return balance.message ? t('reason.fetchError') + '：' + balance.message : t('reason.fetchError');
  }

  /**
   * 生成**展示视图模型**（纯函数，无 DOM、无 React）。
   *
   * 之所以抽出来：这是本插件唯一需要正确性的展示逻辑（余额文案 / 档位 / 倒计时 / 降级文案），
   * 纯函数才能在单测里被钉死，也才能对**构建产物**本身做验证（见 tests/client-bundle.test.js）。
   *
   * @param {{state: object|null, error: string|null, nowMs: number, config: object, t: (key: string) => string, locale: string}} input
   */
  function buildViewModel(input) {
    var state = input.state && typeof input.state === 'object' ? input.state : null;
    var t = input.t;
    var locale = input.locale === 'en' ? 'en' : 'zh';
    var pricing = state && state.pricing && typeof state.pricing === 'object' ? state.pricing : {};
    var timeZone = pricing.timeZone || DEEPSEEK_TIME_ZONE;
    // 倒计时在本地算：规则来自 host，时间来自本机——零请求
    var tier = peakValleyAt(new Date(input.nowMs), pricing);
    var balance = state && state.balance && typeof state.balance === 'object' ? state.balance : null;

    var moneyText = null;
    var badgeText = null;
    var tone = 'ok';
    if (input.error) {
      tone = 'error';
      badgeText = t('reason.transport');
    } else if (balance === null) {
      badgeText = t('loading');
    } else if (balance.ok === true && balance.data && typeof balance.data === 'object') {
      moneyText = formatMoney(balance.data.total, balance.data.currency);
    } else {
      tone = 'error';
      badgeText = reasonText(balance, t);
    }

    var tierLabel = tier.tier === 'peak' ? t('tier.peak') : t('tier.idle');
    var nextTierLabel = tier.nextTier === 'peak' ? t('tier.peak') : t('tier.idle');

    // 周末全天低谷时，40 小时的倒计时没有行动价值 —— 直接给「周末全天低谷」这个事实
    var countdownText = null;
    if (tier.basis !== 'weekend') {
      countdownText = t('countdown.to')
        .replace('{tier}', nextTierLabel)
        .replace('{time}', formatDuration(tier.msToSwitch));
    }

    // ---- 悬停详情 ----
    var details = [];
    if (balance !== null && typeof balance.provider === 'string' && balance.provider.length > 0) {
      details.push([t('panel.source'), balance.provider]);
    }
    if (balance !== null && balance.ok === true && balance.data && typeof balance.data === 'object') {
      details.push([t('panel.total'), formatMoney(balance.data.total, balance.data.currency)]);
      details.push([t('panel.granted'), formatMoney(balance.data.granted, balance.data.currency)]);
      details.push([t('panel.toppedUp'), formatMoney(balance.data.toppedUp, balance.data.currency)]);
    }
    details.push([t('panel.window'), t('panel.windowValue')]);
    if (tier.basis === 'weekend') {
      details.push([t('panel.next'), t('panel.nextWeekend').replace('{day}', weekdayLabel(tier.nextSwitchAt, timeZone, locale))]);
    } else {
      details.push([t('panel.next'), formatClock(tier.nextSwitchAt, timeZone) + ' · ' + nextTierLabel]);
    }

    var prices = null;
    var table = pricing.priceTable;
    if (input.config.hoverPrices !== false && table && typeof table === 'object' && table.peak && table.idle) {
      prices = {
        title: t('panel.prices') + '（' + (table.model || '') + '）',
        peak: t('panel.pricePeak') + '：' + formatPriceRow(table.peak),
        idle: t('panel.priceIdle') + '：' + formatPriceRow(table.idle),
      };
    }

    var updatedAt = balance !== null && typeof balance.fetchedAt === 'number' ? balance.fetchedAt : 0;
    return {
      tone: tone,
      moneyText: moneyText,
      badgeText: badgeText,
      tier: tier.tier,
      tierLabel: tierLabel,
      countdownText: countdownText,
      basis: tier.basis,
      details: details,
      prices: prices,
      updatedText: updatedAt > 0 ? formatClock(updatedAt, timeZone) : t('panel.never'),
      hint: t('panel.hint'),
      stale: input.error !== null && input.error !== undefined,
    };
  }

  /** 单价一行：输入(缓存未命中)/输出/缓存命中输入 */
  function formatPriceRow(row) {
    return '输入 ' + row.inputCacheMiss + ' / 输出 ' + row.output + ' / 缓存命中 ' + row.inputCacheHit;
  }

  /** 极简 h：把 children 收进 props.children（避免在调用点写一堆 props 对象） */
  function makeEl(h) {
    return function el(type, props) {
      var merged = {};
      if (props) {
        for (var key in props) {
          if (Object.prototype.hasOwnProperty.call(props, key)) merged[key] = props[key];
        }
      }
      var children = Array.prototype.slice.call(arguments, 2);
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return h(type, merged);
    };
  }

  /** 返回 DSH 插件 factory：`(require) => module`，module 上是 name / inject / apply 三件套 */
  function makeFactory() {
    return function (require) {
      var module = { exports: {} };
      var react = require('react');
      var useState = react.useState;
      var useEffect = react.useEffect;
      var h = require('react/jsx-runtime').jsx;
      var el = makeEl(h);

      /** 行：[键, 值] */
      function row(pair, key) {
        return el(
          'div',
          { className: 'dshmb-row', key: key },
          el('span', { className: 'dshmb-row-key' }, pair[0]),
          el('span', { className: 'dshmb-row-val' }, pair[1]),
        );
      }

      function apply(ctx) {
        injectCss();

        // 字典：locale 服务按 ns 注册，中英各一份
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN });
        }, 'dsh-model-balance: dictionaries');
        var t = ctx.locale.bind(NS);

        function currentLocale() {
          try {
            var snapshot = ctx.locale.getLocale ? ctx.locale.getLocale() : ctx.locale.getSnapshot();
            var id = snapshot && snapshot.id ? String(snapshot.id) : '';
            return id.indexOf('en') === 0 ? 'en' : 'zh';
          } catch (error) {
            return 'zh';
          }
        }

        var store = createStore();
        var config = { slot: 'overlay', hoverPrices: true };

        // ---- 余额状态轮询：展示层唯一的取数通道 ----
        var pollNow = function () {
          request('/state')
            .then(function (response) {
              if (!response.ok) throw new Error('HTTP ' + response.status);
              return response.json();
            })
            .then(function (body) {
              store.write({ state: body, error: null, at: Date.now() });
            })
            .catch(function (error) {
              var previous = store.read();
              store.write({
                state: previous.state,
                error: error instanceof Error ? error.message : String(error),
                at: Date.now(),
              });
            });
        };

        // ---- 手动刷新：动作端点只回 ok，数据仍从 /state 读（单一出口） ----
        var requestRefresh = function () {
          request('/refresh', { method: 'POST' })
            .catch(function () {
              /* 刷新失败不影响后续轮询；下一次轮询会把真实状态带回来 */
            })
            .then(function () {
              pollNow();
            });
        };

        // ---- 组件 ----
        function useLocaleTick() {
          var pair = useState(0);
          var setTick = pair[1];
          useEffect(function () {
            if (typeof ctx.locale.subscribe !== 'function') return undefined;
            return ctx.locale.subscribe(function () {
              setTick(function (value) {
                return value + 1;
              });
            });
          }, []);
        }

        function Widget() {
          useLocaleTick();
          var statePair = useState(store.read());
          var view = statePair[0];
          var setView = statePair[1];
          var clockPair = useState(Date.now());
          var nowMs = clockPair[0];
          var setNow = clockPair[1];
          var hoverPair = useState(false);
          var hovered = hoverPair[0];
          var setHovered = hoverPair[1];

          useEffect(function () {
            return store.subscribe(function () {
              setView(store.read());
            });
          }, []);

          // 倒计时：本地每秒重算，不产生请求
          useEffect(function () {
            var timer = setInterval(function () {
              setNow(Date.now());
            }, TICK_MS);
            return function () {
              clearInterval(timer);
            };
          }, []);

          var vm = buildViewModel({
            state: view.state,
            error: view.error,
            nowMs: nowMs,
            config: config,
            t: t,
            locale: currentLocale(),
          });

          var badgeChildren = [];
          if (vm.moneyText !== null) {
            badgeChildren.push(el('span', { className: 'dshmb-money', key: 'money' }, vm.moneyText));
          } else {
            badgeChildren.push(
              el(
                'span',
                { className: 'dshmb-reason' + (vm.tone === 'error' ? ' dshmb-reason-error' : ''), key: 'reason' },
                vm.badgeText,
              ),
            );
          }
          if (vm.moneyText !== null) {
            badgeChildren.push(el('span', { className: 'dshmb-tier dshmb-tier-' + vm.tier, key: 'tier' }, vm.tierLabel));
          }
          if (vm.countdownText !== null) {
            badgeChildren.push(el('span', { className: 'dshmb-count', key: 'count' }, vm.countdownText));
          } else {
            badgeChildren.push(el('span', { className: 'dshmb-count', key: 'weekend' }, t('weekend.idle')));
          }

          var panel = null;
          if (hovered) {
            var rows = vm.details.map(function (pair, index) {
              return row(pair, 'row-' + index);
            });
            var panelChildren = [el('div', { className: 'dshmb-panel-title', key: 'title' }, t('title'))].concat(rows);
            if (vm.prices !== null) {
              panelChildren.push(el('div', { className: 'dshmb-sep', key: 'sep' }));
              panelChildren.push(el('div', { className: 'dshmb-row-key', key: 'pt' }, vm.prices.title));
              panelChildren.push(el('div', { className: 'dshmb-row', key: 'pp' }, vm.prices.peak));
              panelChildren.push(el('div', { className: 'dshmb-row', key: 'pi' }, vm.prices.idle));
            }
            panelChildren.push(el('div', { className: 'dshmb-sep', key: 'sep2' }));
            panelChildren.push(
              row([t('panel.updated'), vm.updatedText + (vm.stale ? '（离线）' : '')], 'updated'),
            );
            panelChildren.push(el('div', { className: 'dshmb-hint', key: 'hint' }, vm.hint));
            panel = el('div', { className: 'dshmb-panel' }, panelChildren);
          }

          return el(
            'div',
            { className: 'dshmb-root' + (config.slot === 'sidebar' ? ' is-sidebar' : '') },
            el(
              'div',
              {
                className: 'dshmb-badge',
                role: 'button',
                tabIndex: 0,
                title: t('title'),
                onClick: requestRefresh,
                onMouseEnter: function () {
                  setHovered(true);
                },
                onMouseLeave: function () {
                  setHovered(false);
                },
                onFocus: function () {
                  setHovered(true);
                },
                onBlur: function () {
                  setHovered(false);
                },
              },
              badgeChildren,
            ),
            panel,
          );
        }

        // ---- 轮询与配置 ----
        var pollTimer = null;
        ctx.effect(function () {
          pollNow();
          pollTimer = setInterval(pollNow, POLL_MS);
          return function () {
            if (pollTimer !== null) clearInterval(pollTimer);
            pollTimer = null;
          };
        }, 'dsh-model-balance: poll');

        // 配置决定挂哪个槽位：拉不到就按默认（overlay）挂，绝不因为配置拿不到就什么都不显示
        ctx.effect(function () {
          var cancelled = false;
          var disposeSlot = null;
          request('/config')
            .then(function (response) {
              return response.ok ? response.json() : null;
            })
            .then(function (body) {
              if (body && typeof body === 'object') {
                config.slot = body.slot === 'sidebar' ? 'sidebar' : 'overlay';
                config.hoverPrices = body.hoverPrices !== false;
              }
            })
            .catch(function () {
              /* 用默认配置 */
            })
            .then(function () {
              if (cancelled) return;
              var slotName = config.slot === 'sidebar' ? 'sidebar.footer.action' : 'shell.overlay';
              disposeSlot = ctx.slots.inject(slotName, function* () {
                yield ctx.slots.register({ name: slotName, id: ENTRY_ID, order: 900, label: function () { return t('title'); } }, Widget);
              });
            });
          return function () {
            cancelled = true;
            if (typeof disposeSlot === 'function') disposeSlot();
          };
        }, 'dsh-model-balance: widget slot');

        console.info('[dsh-model-balance] client 半边已装配：slot=' + config.slot);
      }

      module.exports = { name: NAME, inject: ['slots', 'locale'], apply: apply };
      // 测试钩子：让 tests 能直接验证**构建产物**里的展示逻辑（不参与运行时装配）
      module.exports.__test__ = {
        buildViewModel: buildViewModel,
        formatDuration: formatDuration,
        formatMoney: formatMoney,
        formatClock: formatClock,
        peakValleyAt: peakValleyAt,
        dict: { zh: DICT_ZH, en: DICT_EN },
      };
      return module.exports;
    };
  }

  if (!window.__ModuleLoader__) {
    console.error('[dsh-model-balance] 平台模块加载器缺失，client 半边未装配');
    return;
  }
  window.__ModuleLoader__.load({ id: NAME, factory: makeFactory() });
})();
