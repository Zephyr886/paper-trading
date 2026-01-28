document.addEventListener('DOMContentLoaded', () => {
    const balSolInput = document.getElementById('balSol');
    const balBnbInput = document.getElementById('balBnb');
    const btnScaleInput = document.getElementById('btnScale');
    const btnScaleVal = document.getElementById('btnScaleVal');
    const btnOpacityInput = document.getElementById('btnOpacity');
    const btnOpacityVal = document.getElementById('btnOpacityVal');
    const saveBtn = document.getElementById('saveBtn');
    const saveUiBtn = document.getElementById('saveUiBtn');
    const clearBtn = document.getElementById('clearBtn');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPnl = document.getElementById('tab-pnl');
    const tabHoldings = document.getElementById('tab-holdings');
    const tabActivity = document.getElementById('tab-activity');
    const openUiSettingsBtn = document.getElementById('openUiSettings');
    const uiSettingsOverlay = document.getElementById('uiSettingsOverlay');
    const closeUiSettingsBtn = document.getElementById('closeUiSettings');

    function formatAmount(num) {
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
        if (num < 0.001) return num.toFixed(6);
        return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function buildTokenLink(chain, ca) {
        if (!chain || !ca) return null;
        return `https://gmgn.ai/${chain}/token/${ca}`;
    }

    function openTokenPage(chain, ca) {
        const url = buildTokenLink(chain, ca);
        if (url) chrome.tabs.create({ url });
    }

    // Sliders
    btnScaleInput.addEventListener('input', () => {
        btnScaleVal.innerText = btnScaleInput.value + 'x';
    });
    btnOpacityInput.addEventListener('input', () => {
        const opacity = parseFloat(btnOpacityInput.value);
        btnOpacityVal.innerText = Math.round(opacity * 100) + '%';
    });

    // UI settings modal
    function openUiSettings() {
        uiSettingsOverlay.classList.add('open');
        uiSettingsOverlay.setAttribute('aria-hidden', 'false');
    }
    function closeUiSettings() {
        uiSettingsOverlay.classList.remove('open');
        uiSettingsOverlay.setAttribute('aria-hidden', 'true');
    }
    openUiSettingsBtn.addEventListener('click', () => openUiSettings());
    closeUiSettingsBtn.addEventListener('click', () => closeUiSettings());
    uiSettingsOverlay.addEventListener('click', (e) => {
        // click outside modal to close
        if (e.target === uiSettingsOverlay) closeUiSettings();
    });

    // Tab switch
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            tabBtns.forEach(b => b.classList.remove('active'));
            [tabPnl, tabHoldings, tabActivity].forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.getElementById('tab-' + tab);
            if (panel) panel.classList.add('active');
            refreshAllTabs();
        });
    });

    function refreshAllTabs() {
        chrome.storage.local.get(['simTrades', 'simPositions'], (res) => {
            const trades = res.simTrades || [];
            const positions = res.simPositions || {};
            renderPnLTab(trades, positions);
            renderHoldingsTab(trades, positions);
            renderActivityTab(trades);
        });
    }

    function renderPnLTab(trades, positions) {
        const grouped = {};
        trades.forEach(t => {
            const key = `${t.chain}_${t.ca || ''}`;
            if (!key.endsWith('_')) {
                if (!grouped[key]) {
                    grouped[key] = { chain: t.chain, ca: t.ca, ticker: t.ticker, currency: t.currency, trades: [], realizedPnL: 0 };
                }
                grouped[key].trades.push(t);
                if (t.type === 'sell' && t.profit != null) {
                    grouped[key].realizedPnL += parseFloat(t.profit);
                }
            }
        });

        const posKeys = Object.keys(positions);
        posKeys.forEach(key => {
            const pos = positions[key];
            if (pos.amount <= 0) return;
            if (!grouped[key]) {
                const idx = key.indexOf('_');
                const chain = idx >= 0 ? key.slice(0, idx) : 'sol';
                const ca = idx >= 0 ? key.slice(idx + 1) : '';
                grouped[key] = { chain, ca, ticker: '未知', currency: chain === 'bsc' ? 'BNB' : 'SOL', trades: [], realizedPnL: 0 };
            }
            const g = grouped[key];
            g.holdingAmount = pos.amount;
            g.avgPrice = pos.avgPrice;
            const fromTrade = g.trades.find(t => t.ticker);
            if (fromTrade) g.ticker = fromTrade.ticker;
        });

        const entries = Object.entries(grouped).sort((a, b) => {
            const ta = a[1].trades;
            const tb = b[1].trades;
            const lastA = ta.length ? ta[ta.length - 1] : null;
            const lastB = tb.length ? tb[tb.length - 1] : null;
            const idA = lastA && lastA.id ? lastA.id : 0;
            const idB = lastB && lastB.id ? lastB.id : 0;
            return idB - idA;
        });

        tabPnl.innerHTML = '';
        if (entries.length === 0) {
            tabPnl.innerHTML = '<div class="empty">暂无盈亏记录</div>';
            return;
        }

        entries.forEach(([key, g]) => {
            const card = document.createElement('div');
            card.className = 'token-card';
            const hasRealized = g.realizedPnL !== 0;
            const hasHolding = g.holdingAmount > 0;
            let sub = '';
            if (hasRealized) sub += `已实现: <span style="color:${g.realizedPnL >= 0 ? 'var(--good)' : 'var(--bad)'}">${g.realizedPnL >= 0 ? '+' : ''}${g.realizedPnL.toFixed(4)} ${g.currency}</span>`;
            if (hasHolding) {
                if (sub) sub += ' · ';
                sub += `持仓 ${formatAmount(g.holdingAmount)}`;
            }
            card.innerHTML = `
                <div class="token-card-header">
                    <div>
                        <a href="#" class="token-link token-link-pnl" data-chain="${g.chain}" data-ca="${g.ca || ''}">${escapeHtml(g.ticker)}</a>
                        <div class="token-card-meta">${sub || '—'}</div>
                    </div>
                </div>
                <div class="token-card-expand" style="display:none;"></div>
            `;

            const header = card.querySelector('.token-card-header');
            const expand = card.querySelector('.token-card-expand');
            const linkEl = card.querySelector('.token-link-pnl');

            linkEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openTokenPage(g.chain, g.ca);
            });

            header.addEventListener('click', (e) => {
                if (e.target.closest('.token-link')) return;
                const wasShown = expand.style.display !== 'none';
                document.querySelectorAll('.token-card-expand').forEach(el => { el.style.display = 'none'; });
                if (!wasShown) {
                    expand.style.display = 'block';
                    expand.innerHTML = g.trades.map(t => {
                        const profitNum = t.profit != null ? parseFloat(t.profit) : NaN;
                        const pnl = !isNaN(profitNum) ? `<div style="color:${profitNum >= 0 ? 'var(--good)' : 'var(--bad)'}">利润 ${t.profit} ${t.currency}</div>` : '';
                        return `<div class="trade-item ${t.type === 'sell' ? 'sell' : ''}">
                            <div style="display:flex;justify-content:space-between;font-weight:bold;">
                                <span style="color:${t.type === 'sell' ? 'var(--bad)' : 'var(--accent-2)'}">${t.actionDesc}</span>
                            </div>
                            <div style="color:#888;margin-top:4px;">价格 ${t.entryPrice} U ${pnl}<span style="font-size:10px;color:#555;"> ${t.buyTime}</span></div>
                        </div>`;
                    }).join('');
                }
            });

            tabPnl.appendChild(card);
        });
    }

    function renderHoldingsTab(trades, positions) {
        const hold = Object.entries(positions).filter(([, pos]) => pos.amount > 0);
        const tickerMap = {};
        trades.forEach(t => {
            const k = `${t.chain}_${t.ca || ''}`;
            if (!tickerMap[k] && t.ticker) tickerMap[k] = t.ticker;
        });

        tabHoldings.innerHTML = '';
        if (hold.length === 0) {
            tabHoldings.innerHTML = '<div class="empty">暂无持有代币</div>';
            return;
        }

        hold.forEach(([key, pos]) => {
            const idx = key.indexOf('_');
            const chain = idx >= 0 ? key.slice(0, idx) : 'sol';
            const ca = idx >= 0 ? key.slice(idx + 1) : '';
            const ticker = tickerMap[key] || '未知';
            const card = document.createElement('div');
            card.className = 'token-card';
            card.innerHTML = `
                <div class="token-card-header">
                    <div>
                        <a href="#" class="token-link token-link-hold" data-chain="${chain}" data-ca="${ca || ''}">${escapeHtml(ticker)}</a>
                        <div class="token-card-meta">${chain === 'bsc' ? 'BNB' : 'SOL'} · 持仓 ${formatAmount(pos.amount)}</div>
                    </div>
                </div>
            `;
            const linkEl = card.querySelector('.token-link-hold');
            linkEl.addEventListener('click', (e) => {
                e.preventDefault();
                openTokenPage(chain, ca);
            });
            tabHoldings.appendChild(card);
        });
    }

    function renderActivityTab(trades) {
        const sorted = trades.slice().sort((a, b) => (b.id || 0) - (a.id || 0));
        tabActivity.innerHTML = '';
        if (sorted.length === 0) {
            tabActivity.innerHTML = '<div class="empty">暂无活动</div>';
            return;
        }

        const list = document.createElement('div');
        list.className = 'trade-list';
        sorted.forEach(trade => {
            const div = document.createElement('div');
            div.className = 'trade-item' + (trade.type === 'sell' ? ' sell' : '');

            const profitNum = trade.profit != null ? parseFloat(trade.profit) : NaN;
            const pnlDisplay = !isNaN(profitNum)
                ? `<div style="color:${profitNum > 0 ? 'var(--good)' : 'var(--bad)'}">利润: ${trade.profit} ${trade.currency}</div>`
                : '';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-weight:bold;">
                    <a href="#" class="token-link token-link-act" data-chain="${trade.chain}" data-ca="${trade.ca || ''}">${escapeHtml(trade.ticker)}</a>
                    <span style="color:${trade.type === 'sell' ? 'var(--bad)' : 'var(--accent-2)'}">${trade.actionDesc}</span>
                </div>
                <div style="color:#888; margin-top:4px;">
                    价格: ${trade.entryPrice} U<br>
                    ${pnlDisplay}
                    <span style="font-size:10px; color:#555;">${trade.buyTime}</span>
                </div>
            `;
            const linkEl = div.querySelector('.token-link-act');
            linkEl.addEventListener('click', (e) => {
                e.preventDefault();
                openTokenPage(trade.chain, trade.ca);
            });
            list.appendChild(div);
        });
        tabActivity.appendChild(list);
    }

    function escapeHtml(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    // Load
    chrome.storage.local.get(['simSettings', 'simTrades', 'simPositions', 'walletBalance'], (result) => {
        if (result.simSettings && result.simSettings.btnScale) {
            btnScaleInput.value = result.simSettings.btnScale;
            btnScaleVal.innerText = result.simSettings.btnScale + 'x';
        }
        const opacity = (result.simSettings && result.simSettings.btnOpacity !== undefined) ? result.simSettings.btnOpacity : 1.0;
        btnOpacityInput.value = opacity;
        btnOpacityVal.innerText = Math.round(opacity * 100) + '%';

        const balances = result.walletBalance || { sol: 10, bnb: 5 };
        balSolInput.value = balances.sol;
        balBnbInput.value = balances.bnb;

        refreshAllTabs();
    });

    function persistUiSettings({ scale, opacity }, onDone) {
        chrome.storage.local.get(['simSettings'], (res) => {
            const newSettings = {
                ...(res.simSettings || {}),
                btnScale: scale,
                btnOpacity: opacity,
                amount: 0.1
            };
            chrome.storage.local.set({ simSettings: newSettings }, () => onDone && onDone());
        });
    }

    // Save
    saveBtn.addEventListener('click', () => {
        const sol = parseFloat(balSolInput.value);
        const bnb = parseFloat(balBnbInput.value);
        const scale = parseFloat(btnScaleInput.value);
        const opacity = parseFloat(btnOpacityInput.value);
        if (isNaN(sol) || isNaN(bnb)) { alert('请输入有效金额'); return; }

        persistUiSettings({ scale, opacity }, () => {
            chrome.storage.local.set({ walletBalance: { sol, bnb } }, () => {
                const orig = saveBtn.innerText;
                saveBtn.innerText = '已保存! (请刷新页面生效)';
                saveBtn.style.background = '#2f7d57';
                setTimeout(() => {
                    saveBtn.innerText = orig;
                    saveBtn.style.background = 'var(--accent)';
                }, 1500);
            });
        });
    });

    // Save UI-only settings (modal)
    saveUiBtn.addEventListener('click', () => {
        const scale = parseFloat(btnScaleInput.value);
        const opacity = parseFloat(btnOpacityInput.value);
        persistUiSettings({ scale, opacity }, () => {
            const orig = saveUiBtn.innerText;
            saveUiBtn.innerText = '已保存 (刷新页面生效)';
            saveUiBtn.style.background = '#2f7d57';
            setTimeout(() => {
                saveUiBtn.innerText = orig;
                saveUiBtn.style.background = 'var(--accent)';
            }, 1200);
            closeUiSettings();
        });
    });

    // Clear
    clearBtn.addEventListener('click', () => {
        if (confirm('确定清空记录并重置持仓吗？余额将保留。')) {
            chrome.storage.local.set({ simTrades: [], simPositions: {} }, () => refreshAllTabs());
        }
    });
});
