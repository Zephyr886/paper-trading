// ==========================================
// 1. 全局状态 & 初始化
// ==========================================
let baseAssetPrices = { sol: 0, bnb: 0 };
let currentTokenInfo = { price: 0, mc: 0 }; // 代币 USD 价格

// 应用用户设置 (按钮缩放和透明度)
function applyUserSettings() {
    chrome.storage.local.get(['simSettings'], (res) => {
        const scale = (res.simSettings && res.simSettings.btnScale) ? res.simSettings.btnScale : 1.0;
        const opacity = (res.simSettings && res.simSettings.btnOpacity !== undefined) ? res.simSettings.btnOpacity : 1.0;
        document.documentElement.style.setProperty('--sim-btn-scale', scale);
        document.documentElement.style.setProperty('--sim-btn-opacity', opacity);
    });
}
applyUserSettings();

// ==========================================
// 2. 工具函数
// ==========================================
function parseNumberClean(text) {
    if (!text) return 0;
    let clean = text.toUpperCase().replace('$', '').replace(/,/g, '').trim();
    let multiplier = 1;
    if (clean.endsWith('K')) { multiplier = 1_000; clean = clean.replace('K', ''); }
    else if (clean.endsWith('M')) { multiplier = 1_000_000; clean = clean.replace('M', ''); }
    else if (clean.endsWith('B')) { multiplier = 1_000_000_000; clean = clean.replace('B', ''); }
    let num = parseFloat(clean);
    return isNaN(num) ? 0 : num * multiplier;
}

function formatPrice(priceVal) {
    if (!priceVal || priceVal === 0) return "0";
    if (priceVal < 0.0000001) return priceVal.toFixed(11).replace(/\.?0+$/, "");
    if (priceVal < 0.001) return priceVal.toFixed(8).replace(/\.?0+$/, "");
    if (priceVal < 1) return priceVal.toFixed(5).replace(/\.?0+$/, "");
    return priceVal.toFixed(2);
}

function formatAmount(num) {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
    if (num < 0.001) return num.toFixed(6);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** 从 pathname 解析并校验合约地址：BSC 0x+40 位 hex，Solana 32–44 位 base58 */
function parseContractAddress(pathname) {
    const parts = pathname.split('/').map(p => p.trim()).filter(Boolean);
    const tokenIdx = parts.indexOf('token');
    if (tokenIdx < 0 || tokenIdx >= parts.length - 1) return null;
    const ca = parts[tokenIdx + 1];
    if (!ca) return null;
    if (ca.startsWith('0x') && /^0x[a-fA-F0-9]{40}$/.test(ca)) return ca;
    if (ca.length >= 32 && ca.length <= 44 && !ca.startsWith('0x')) return ca;
    return null;
}

function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; 
        background: ${type === 'sell' ? '#ff5252' : '#00bcd4'}; color: white; 
        padding: 10px 20px; border-radius: 4px; z-index: 9999999;
        font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-family: 'Segoe UI', sans-serif;
    `;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ==========================================
// 3. 价格监控循环
// ==========================================
setInterval(() => {
    // 抓取 SOL 价格
    const greenEls = document.querySelectorAll('.text-green-100');
    for (let el of greenEls) {
        if (el.innerText.includes('$')) {
            const val = parseNumberClean(el.innerText);
            if (val > 0) baseAssetPrices.sol = val;
        }
    }
    // 抓取 BNB 价格
    const yellowEls = document.querySelectorAll('.text-yellow-100');
    for (let el of yellowEls) {
        if (el.innerText.includes('$')) {
            const val = parseNumberClean(el.innerText);
            if (val > 0) baseAssetPrices.bnb = val;
        }
    }
}, 1000);

// ==========================================
// 4. 核心交易逻辑 (资金交互)
// ==========================================
function coreTradeLogic(params) {
    let basePriceUSD = params.chain === 'bsc' ? baseAssetPrices.bnb : baseAssetPrices.sol;
    let currency = params.chain === 'bsc' ? 'BNB' : 'SOL';
    
    // 容错：如果没抓到，给个默认值防止卡死 (仅用于测试)
    if (basePriceUSD === 0) basePriceUSD = currency === 'BNB' ? 600 : 150; 

    // 计算代币 USD 价格
    const mcValue = parseNumberClean(params.tokenMc);
    const tokenPriceUSD = mcValue > 0 ? (mcValue / 1_000_000_000) : 0;

    if (tokenPriceUSD <= 0) { showToast("无法计算代币价格 (无市值数据)", "sell"); return; }

    chrome.storage.local.get(['simPositions', 'simTrades', 'walletBalance'], (res) => {
        let positions = res.simPositions || {};
        let trades = res.simTrades || [];
        // 初始化钱包余额
        let wallet = res.walletBalance || { sol: 10, bnb: 5 };
        
        const posKey = `${params.chain}_${params.ca}`;
        let myPos = positions[posKey] || { amount: 0, avgPrice: 0 }; 

        // 检查余额
        const currentBalance = params.chain === 'bsc' ? wallet.bnb : wallet.sol;

        if (params.type === 'buy') {
            // --- 买入 ---
            if (currentBalance < params.amount) {
                showToast(`余额不足！当前: ${currentBalance.toFixed(2)} ${currency}`, "sell");
                return;
            }

            const investUSD = params.amount * basePriceUSD;
            const tokensBought = investUSD / tokenPriceUSD;

            // 扣除余额
            if (params.chain === 'bsc') wallet.bnb -= params.amount;
            else wallet.sol -= params.amount;

            // 更新持仓成本
            const oldTotalCost = myPos.amount * myPos.avgPrice;
            const newTotalCost = oldTotalCost + investUSD;
            const newTotalAmount = myPos.amount + tokensBought;

            myPos.amount = newTotalAmount;
            myPos.avgPrice = newTotalCost / newTotalAmount;

            trades.push({
                id: Date.now(), type: 'buy', chain: params.chain, currency, ticker: params.ticker,
                ca: params.ca,
                entryPrice: formatPrice(tokenPriceUSD), buyAmount: params.amount, tokenAmount: tokensBought,
                actionDesc: `买入 ${params.amount} ${currency}`, buyTime: new Date().toLocaleTimeString()
            });

            showToast(`买入成功！+${formatAmount(tokensBought)} ${params.ticker}`);

        } else if (params.type === 'sell') {
            // --- 卖出 ---
            if (myPos.amount <= 0) { showToast("无持仓可卖", "sell"); return; }

            const percent = params.amount / 100;
            const tokensSold = myPos.amount * percent;
            
            const receiveUSD = tokensSold * tokenPriceUSD;
            const receiveBase = receiveUSD / basePriceUSD;
            
            // 利润计算
            const profitUSD = (tokenPriceUSD - myPos.avgPrice) * tokensSold;
            const profitBase = profitUSD / basePriceUSD;

            // 增加余额
            if (params.chain === 'bsc') wallet.bnb += receiveBase;
            else wallet.sol += receiveBase;

            myPos.amount -= tokensSold;
            if (myPos.amount < 0) myPos.amount = 0;

            trades.push({
                id: Date.now(), type: 'sell', chain: params.chain, currency, ticker: params.ticker,
                ca: params.ca,
                entryPrice: formatPrice(tokenPriceUSD), sellPercent: params.amount, tokenAmount: tokensSold,
                profit: profitBase.toFixed(4), actionDesc: `卖出 ${params.amount}%`, buyTime: new Date().toLocaleTimeString()
            });

            showToast(`卖出成功！${profitBase > 0 ? '盈' : '亏'} ${profitBase.toFixed(4)} ${currency}`);
        }

        // 保存所有数据
        positions[posKey] = myPos;
        chrome.storage.local.set({ simPositions: positions, simTrades: trades, walletBalance: wallet }, () => {
            if (typeof updatePanelUI === 'function') updatePanelUI();
        });
    });
}

// ==========================================
// 5. 悬浮窗逻辑 (代币页)
// ==========================================
let panelInterval = null;
let currentPath = window.location.href;

setInterval(() => {
    if (currentPath !== window.location.href) {
        currentPath = window.location.href;
        checkPage();
    }
}, 1000);
checkPage();

function checkPage() {
    const panel = document.getElementById('gmgn-float-panel');
    if (panel) panel.remove();
    if (panelInterval) clearInterval(panelInterval);

    if (currentPath.includes('/token/')) {
        initTokenPage();
    } else {
        initTrenchObserver(); // 战壕页模式
    }
}

function initTokenPage() {
    if (currentPath.includes('/eth/')) return;
    let chain = 'sol';
    if (currentPath.includes('/bsc/')) chain = 'bsc';

    chrome.storage.local.get(['panelSettings'], (res) => {
        const DEFAULT_CONFIG = {
            sol: { buys: [0.1, 0.5, 1.0, 5.0], sells: [10, 25, 50, 100] },
            bsc: { buys: [0.01, 0.05, 0.1, 0.5], sells: [10, 25, 50, 100] }
        };
        const settings = (res.panelSettings && res.panelSettings[chain]) || DEFAULT_CONFIG[chain] || DEFAULT_CONFIG.sol;
        renderPanel(chain, settings);
    });
    panelInterval = setInterval(updatePanelUI, 1000);
}

function renderPanel(chain, settings) {
    const currency = chain === 'bsc' ? 'BNB' : 'SOL';
    const panel = document.createElement('div');
    panel.id = 'gmgn-float-panel';
    panel.innerHTML = `
        <div class="drag-handle-container" id="drag-bar"><div class="drag-handle-bar"></div></div>
        <div class="panel-header">
            <span class="panel-title">纸上谈币 (${currency})</span>
            <span class="panel-balance" id="disp-wallet-bal">Bal: --</span>
            <button class="panel-settings-btn" id="openSimSettings">⚙️</button>
        </div>
        <div class="panel-stats">
            <div class="stat-row">
                <span class="stat-label">价格</span>
                <div class="stat-content">
                    <span class="main-val" id="disp-price">--</span>
                </div>
            </div>
            <div class="stat-row">
                <span class="stat-label">持仓</span>
                <div class="stat-content">
                    <span class="main-val" id="disp-holdings">0</span>
                    <span class="sub-val" id="disp-holdings-val">≈ 0 ${currency}</span>
                </div>
            </div>
            <div class="stat-row">
                <span class="stat-label">浮盈</span>
                <div class="stat-content">
                    <span class="main-val" id="disp-pnl-pct">--</span>
                    <span class="sub-val" id="disp-pnl-val">--</span>
                </div>
            </div>
        </div>
        <div class="panel-body">
            <div class="btn-grid">
                ${settings.buys.map(v => `<button class="sim-trade-btn btn-buy" data-type="buy" data-val="${v}">${v}</button>`).join('')}
                ${settings.sells.map(v => `<button class="sim-trade-btn btn-sell" data-type="sell" data-val="${v}">${v}%</button>`).join('')}
            </div>
        </div>
        <div class="resize-handle" id="resize-btn"></div>
    `;
    document.body.appendChild(panel);
    makeInteractable(panel);

    // 绑定设置按钮 (简单提示)
    panel.querySelector('#openSimSettings').addEventListener('click', () => { 
        alert("请点击浏览器右上角插件图标进行详细设置 (余额、按钮大小等)");
    });

    // 绑定交易
    panel.querySelectorAll('.sim-trade-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pageData = scrapeTokenPageData();
            if (!pageData.ca) return;
            coreTradeLogic({
                type: btn.getAttribute('data-type'),
                amount: parseFloat(btn.getAttribute('data-val')),
                chain: chain,
                ca: pageData.ca,
                ticker: pageData.ticker,
                name: pageData.name,
                tokenMc: pageData.mc
            });
        });
    });
}

// 交互修复：使用 document 监听，防止拖快丢失
function makeInteractable(panel) {
    const dragBar = panel.querySelector('#drag-bar');
    const resizeBtn = panel.querySelector('#resize-btn');

    // 1. 拖拽
    dragBar.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 防止选中文本
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = panel.offsetLeft;
        const startTop = panel.offsetTop;

        function onMouseMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = `${startLeft + dx}px`;
            panel.style.top = `${startTop + dy}px`;
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        // 关键：绑定到 document 上，而不是元素上
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // 2. 缩放
    resizeBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = panel.offsetWidth;
        const startHeight = panel.offsetHeight;

        function onMouseMove(e) {
            const newW = Math.max(260, startWidth + (e.clientX - startX));
            const newH = Math.max(240, startHeight + (e.clientY - startY));
            panel.style.width = `${newW}px`;
            panel.style.height = `${newH}px`;
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function scrapeTokenPageData() {
    const ca = parseContractAddress(window.location.pathname);
    const tickerEl = document.querySelector('span.text-text-100.text-xl');
    const ticker = tickerEl ? tickerEl.innerText.trim() : "未知";
    const nameEl = document.querySelector('span.text-text-300.font-normal.text-base');
    const name = nameEl ? nameEl.innerText.trim() : "";
    let mcText = "$0";
    const mcEls = document.querySelectorAll('.info-item-value');
    for (let el of mcEls) { if (el.innerText.includes('$')) { mcText = el.innerText; break; } }
    return { ca, ticker, name, mc: mcText };
}

// 刷新 UI：显示全方位数据
function updatePanelUI() {
    if (!document.getElementById('disp-price')) return;
    const pageData = scrapeTokenPageData();
    if (!pageData.ca) return;

    let chain = window.location.href.includes('/bsc/') ? 'bsc' : 'sol';
    let basePrice = chain === 'bsc' ? baseAssetPrices.bnb : baseAssetPrices.sol;
    let currency = chain === 'bsc' ? 'BNB' : 'SOL';

    // 1. 计算代币价格
    const mcVal = parseNumberClean(pageData.mc);
    const tokenPriceUSD = mcVal / 1_000_000_000;

    // 2. 更新显示
    document.getElementById('disp-price').innerText = `$${formatPrice(tokenPriceUSD)}`;

    chrome.storage.local.get(['simPositions', 'walletBalance'], (res) => {
        // 更新钱包余额
        const wallet = res.walletBalance || { sol: 10, bnb: 5 };
        const bal = chain === 'bsc' ? wallet.bnb : wallet.sol;
        const balEl = document.getElementById('disp-wallet-bal');
        if(balEl) balEl.innerText = `Bal: ${bal.toFixed(2)}`;

        // 更新持仓详情
        const posKey = `${chain}_${pageData.ca}`;
        const myPos = res.simPositions ? res.simPositions[posKey] : null;

        const holdEl = document.getElementById('disp-holdings');
        const holdValEl = document.getElementById('disp-holdings-val');
        const pnlPctEl = document.getElementById('disp-pnl-pct');
        const pnlValEl = document.getElementById('disp-pnl-val');

        if (myPos && myPos.amount > 0) {
            // 持仓数量
            holdEl.innerText = formatAmount(myPos.amount);
            
            // 持仓价值 (Base & USD)
            const valUSD = myPos.amount * tokenPriceUSD;
            const valBase = basePrice > 0 ? (valUSD / basePrice) : 0;
            holdValEl.innerText = `≈ ${valBase.toFixed(2)} ${currency} ≈ $${formatAmount(valUSD)}`;

            // 浮盈计算
            const pnlUSD = (tokenPriceUSD - myPos.avgPrice) * myPos.amount;
            const pnlBase = basePrice > 0 ? (pnlUSD / basePrice) : 0;
            const pnlPct = ((tokenPriceUSD - myPos.avgPrice) / myPos.avgPrice) * 100;

            const pnlColor = pnlPct >= 0 ? '#00bfa5' : '#ff5252';
            const sign = pnlPct >= 0 ? '+' : '';

            pnlPctEl.innerText = `${sign}${pnlPct.toFixed(2)}%`;
            pnlPctEl.style.color = pnlColor;
            
            pnlValEl.innerText = `${sign}${pnlBase.toFixed(2)} ${currency} (${sign}$${pnlUSD.toFixed(0)})`;
            pnlValEl.style.color = pnlColor;

        } else {
            holdEl.innerText = "0";
            holdValEl.innerText = "≈ 0";
            pnlPctEl.innerText = "--";
            pnlPctEl.style.color = "#888";
            pnlValEl.innerText = "--";
        }
    });
}

// ==========================================
// 6. 战壕页处理 (自动注入 + 缩放)
// ==========================================
function initTrenchObserver() {
    const observer = new MutationObserver(() => {
        const cards = document.querySelectorAll('div[href*="/token/"]');
        cards.forEach(processTrenchCard);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { document.querySelectorAll('div[href*="/token/"]').forEach(processTrenchCard); }, 1500);
}

function processTrenchCard(card) {
    if (card.querySelector('.gmgn-sim-btn-wrapper')) return;
    const buyContainer = card.querySelector('[data-sentry-component="BuyButtons"]');
    if (!buyContainer) return;
    const href = card.getAttribute('href') || '';
    const match = href.match(/^\/([^\/]+)\/token\/([^\?]+)/);
    const chain = match ? match[1] : 'sol';
    if (chain === 'eth') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'gmgn-sim-btn-wrapper';
    
    const btn = document.createElement('div');
    btn.className = 'gmgn-sim-btn';
    
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 16 16" fill="currentColor" class="gmgn-sim-btn-icon"><path d="m13.688 8.1195-6.471 7.7057c-.2058.2451-.6034.0606-.5491-.2548l1.0063-5.8438-4.6175-.061c-.8792-.0117-1.352-1.0376-.7897-1.7136L8.7226.1906c.2052-.2467.6046-.0625.5501.2537L8.2473 6.3988l4.641.0033c.8877.0007 1.3706 1.0377.7997 1.7174"></path></svg>`;
    btn.innerHTML = `${iconSvg} 模拟`;
    
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        const ca = match ? match[2] : '未知CA';
        let ticker = '未知';
        const tickerEl = card.querySelector('[data-sentry-component="TokenBaseInfo"] [data-sentry-component="TooltipCopy"]');
        if (tickerEl) ticker = tickerEl.innerText.trim();
        let mcText = '$0';
        const volumeBlock = card.querySelector('[data-sentry-component="Volume"]');
        if (volumeBlock) {
            const items = volumeBlock.querySelectorAll('div');
            for (const item of items) {
                if (item.innerText.includes('MC')) {
                    const spans = item.querySelectorAll('span');
                    if (spans.length > 0) mcText = spans[spans.length - 1].innerText;
                }
            }
        }
        chrome.storage.local.get(['simSettings'], (res) => {
            const amt = (res.simSettings && res.simSettings.amount) ? res.simSettings.amount : 0.1;
            coreTradeLogic({ type: 'buy', amount: amt, chain, ca, ticker, name: '', tokenMc: mcText });
        });
        return false;
    }, true);
    
    wrapper.appendChild(btn);
    buyContainer.insertBefore(wrapper, buyContainer.firstChild);
}