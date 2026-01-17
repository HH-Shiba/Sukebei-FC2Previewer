// background.js (三重備援版)

let offscreenDocumentCreated = false;

chrome.action.onClicked.addListener((tab) => {
  chrome.storage.local.get("sidebarOpen", (result) => {
    let newState = !result.sidebarOpen;
    chrome.storage.local.set({ sidebarOpen: newState }, () => {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR", sidebarOpen: newState });
    });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_PREVIEW_OFFICIAL") {
    handleOfficialFetch(msg.videoNumber, sendResponse);
    return true;
  }

  if (msg.type === "FETCH_SUPJAV") {
    handleSupjavFetch(msg.searchUrl, sendResponse);
    return true;
  }

  if (msg.type === "FETCH_PREVIEW" || msg.type === "FETCH_VIDEO_INFO" || msg.type === "FETCH_RELATED_VIDEOS") {
    handleFetchWithTripleBackup(msg, sendResponse);
    return true;
  }
});

// 三重備援：offscreen → content fetch (通知) → 隱藏分頁
async function handleFetchWithTripleBackup(msg, sendResponse) {
  const targetUrl = msg.type === "FETCH_RELATED_VIDEOS" ? msg.actressUrl : `https://fd2ppv.cc/articles/${msg.videoNumber}`;
  
  // [方案 A] 嘗試 offscreen document
  try {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_FETCH",
      url: targetUrl,
      requiresCookie: false
    });
    
    if (result && result.success && !result.html.includes("Just a moment")) {
      console.log(`[Offscreen] 成功獲取: ${targetUrl}`);
      sendResponse({ success: true, html: result.html });
      return;
    }
  } catch (error) {
    console.log(`[Offscreen] 失敗: ${error.message}`);
  }

  // [方案 B] 通知 content script 嘗試本地 fetch (不等待結果，直接進 fallback)
  // 這裡我們直接跳到方案 C，因為方案 B 成功率不高且會增加複雜度
  
  // [方案 C - Fallback] 使用隱藏分頁（現有機制）
  console.log(`[Fallback] 使用隱藏分頁: ${targetUrl}`);
  handleHiddenTabFetch(targetUrl, sendResponse);
}

// 隱藏分頁抓取（保留原邏輯）
function handleHiddenTabFetch(targetUrl, sendResponse) {
  chrome.tabs.create({ url: targetUrl, active: false, pinned: true }, (tab) => {
    let hasResponded = false;

    const checkTab = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML
          }).then(results => {
            const html = results[0].result;
            if (html.includes("Just a moment...")) return;

            if (!hasResponded) {
              hasResponded = true;
              chrome.tabs.onUpdated.removeListener(checkTab);
              chrome.tabs.remove(tab.id);
              sendResponse({ success: true, html });
            }
          }).catch(err => {
            if (!hasResponded) {
              hasResponded = true;
              chrome.tabs.remove(tab.id);
              sendResponse({ success: false, error: err.message });
            }
          });
        }, 800);
      }
    };

    chrome.tabs.onUpdated.addListener(checkTab);

    setTimeout(() => {
      if (!hasResponded) {
        hasResponded = true;
        chrome.tabs.onUpdated.removeListener(checkTab);
        chrome.tabs.remove(tab.id);
        sendResponse({ success: false, error: "請求超時，Cloudflare 驗證失敗" });
      }
    }, 10000);
  });
}

// 處理 Supjav 搜尋請求（優先 offscreen，失敗 fallback 隱藏分頁）
async function handleSupjavFetch(searchUrl, sendResponse) {
  // 優先嘗試 offscreen
  try {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_FETCH",
      url: searchUrl,
      requiresCookie: false
    });
    
    if (result && result.success) {
      console.log(`[Offscreen] 成功獲取 Supjav: ${searchUrl}`);
      sendResponse({ success: true, html: result.html });
      return;
    }
  } catch (error) {
    console.log(`[Offscreen] Supjav 失敗: ${error.message}`);
  }

  // Fallback 到隱藏分頁
  console.log(`[Fallback] Supjav 使用隱藏分頁: ${searchUrl}`);
  handleHiddenTabFetch(searchUrl, sendResponse);
}

async function handleOfficialFetch(videoNumber, sendResponse) {
  await chrome.cookies.set({ url: "https://adult.contents.fc2.com", name: "_ac", value: "1", path: "/" });
  const url = `https://adult.contents.fc2.com/article/${videoNumber}/`;
  
  // 優先嘗試 offscreen
  try {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_FETCH",
      url: url,
      requiresCookie: true
    });
    
    if (result && result.success) {
      console.log(`[Offscreen] 成功獲取 FC2 官方: ${url}`);
      sendResponse({ success: true, html: result.html });
      return;
    }
  } catch (error) {
    console.log(`[Offscreen] FC2 官方失敗: ${error.message}`);
  }

  // Fallback 到直接 fetch（service worker 可直接 fetch 官方）
  fetch(url, { credentials: "include" })
    .then(r => r.text())
    .then(html => sendResponse({ success: true, html }))
    .catch(e => sendResponse({ success: false, error: e.message }));
}

// 確保 offscreen document 存在
async function ensureOffscreenDocument() {
  if (offscreenDocumentCreated) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    offscreenDocumentCreated = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_SCRAPING'],
    justification: 'Fetch and parse HTML from external sites'
  });

  offscreenDocumentCreated = true;
  console.log('Offscreen document created');
}
