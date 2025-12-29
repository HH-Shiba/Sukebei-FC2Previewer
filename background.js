// background.js (終極穩定版)

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

  if (msg.type === "FETCH_VIDEO_INFO" || msg.type === "FETCH_RELATED_VIDEOS") {
    const targetUrl = msg.type === "FETCH_RELATED_VIDEOS" ? msg.actressUrl : `https://fd2ppv.cc/articles/${msg.videoNumber}`;
    
    // 使用真實 Tab 繞過 TLS 指紋，這是目前唯一的「全域最佳解」
    chrome.tabs.create({ url: targetUrl, active: false, pinned: true }, (tab) => {
      let hasResponded = false;

      const checkTab = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          // 給予 500ms 確保 Cloudflare 驗證跳轉完成
          setTimeout(() => {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => document.documentElement.outerHTML
            }).then(results => {
              const html = results[0].result;
              if (html.includes("Just a moment...")) return; // 還在驗證則等待下一輪或超時

              if (!hasResponded) {
                hasResponded = true;
                chrome.tabs.onUpdated.removeListener(checkTab);
                chrome.tabs.remove(tab.id); // 立即關閉，減少視覺干擾
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

      // 設定安全超時，防止分頁卡死
      setTimeout(() => {
        if (!hasResponded) {
          hasResponded = true;
          chrome.tabs.onUpdated.removeListener(checkTab);
          chrome.tabs.remove(tab.id);
          sendResponse({ success: false, error: "請求超時，Cloudflare 驗證失敗" });
        }
      }, 10000);
    });
    return true;
  }
});

async function handleOfficialFetch(videoNumber, sendResponse) {
  await chrome.cookies.set({ url: "https://adult.contents.fc2.com", name: "_ac", value: "1", path: "/" });
  const url = `https://adult.contents.fc2.com/article/${videoNumber}/`;
  fetch(url, { credentials: "include" })
    .then(r => r.text())
    .then(html => sendResponse({ success: true, html }))
    .catch(e => sendResponse({ success: false, error: e.message }));
}