// 3.1 版本 - content.js (重構優化版)

let sidebarOpen = false;
let sidebar = null;
const fetchCache = {}; // 快取已抓取的內容

// ---------------------- Utility Functions ----------------------

// 統一的訊息發送工具
function sendMessageFetch(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (response && response.success) {
        resolve(response.html);
      } else {
        reject(new Error(response ? response.error : "Unknown error"));
      }
    });
  });
}

// HTML 解析工具
function parseHtml(htmlString) {
  return new DOMParser().parseFromString(htmlString, "text/html");
}

// 防抖延遲執行
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 初始化：如果側邊欄開啓則自動刷新
chrome.storage.local.get("sidebarOpen", (result) => {
  if (result.sidebarOpen) {
    openSidebar();
    autoRefreshAll();
  }
});

// 監聽背景訊息：側邊欄開關
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TOGGLE_SIDEBAR") {
    msg.sidebarOpen ? (openSidebar(), autoRefreshAll()) : closeSidebar();
  }
});

// 打開側邊欄並注入基礎結構
function openSidebar() {
  if (!sidebar) {
    sidebar = document.createElement("div");
    sidebar.id = "fc2-sidebar";
    sidebar.style.cssText = `
      position: fixed; top: 0; right: 0; width: 360px; height: 100%;
      background-color: #fff; border-left: 1px solid #ccc; z-index: 999999; overflow: auto; padding: 10px;
    `;
    sidebar.innerHTML = `
      <h4>FC2 預覽</h4>
      <p id="fc2-message">等待自動提取影片編號...</p>
      <div id="fc2-info" style="margin-top:10px;"></div>
      <hr>
      <div id="fc2-preview" style="margin-top:10px;"></div>
      <hr>
      <h4>FC2-Preview (Sample Images)</h4>
      <div id="fc2-preview-official" style="margin-top:10px;"></div>
    `;
    document.body.appendChild(sidebar);
  }
  sidebarOpen = true;
}

function closeSidebar() {
  if (sidebar) {
    document.body.removeChild(sidebar);
    sidebar = null;
  }
  sidebarOpen = false;
}

function autoRefreshAll() {
  if (!sidebarOpen || !window.location.href.includes("/view/")) return;
  setTimeout(() => {
    const videoNumber = autoExtractVideoNumber();
    if (!videoNumber) return;
    const msgElem = sidebar.querySelector("#fc2-message");
    if (msgElem) msgElem.textContent = "";
    ["fc2-info", "fc2-preview", "fc2-preview-official"].forEach(sectionId => {
      updateSection(sectionId, videoNumber);
    });
  }, 1000);
}

function updateSection(sectionId, videoNumber) {
  const fetchMap = {
    "fc2-info": fetchVideoInfo,
    "fc2-preview": fetchPreviewSection,
    "fc2-preview-official": fetchOfficialPreviewSection
  };
  const updateMap = {
    "fc2-info": updateVideoInfo,
    "fc2-preview": updatePreviewSection,
    "fc2-preview-official": updateOfficialPreviewSection
  };
  const elem = sidebar.querySelector("#" + sectionId);
  if (elem) {
    elem.innerHTML = `<p>正在提取 ${sectionId}...</p>`;
    fetchMap[sectionId](videoNumber)
      .then(result => {
        if (!result || (typeof result === "string" && result.startsWith("Error:"))) {
          elem.innerHTML = `<p>未能提取 ${sectionId}。（${result}）</p>`;
        } else {
          updateMap[sectionId](result);
        }
      })
      .catch(error => {
        console.error(`Error updating section ${sectionId}:`, error);
        elem.innerHTML = `<p>提取 ${sectionId} 時發生錯誤。</p>`;
      });
  }
}

function autoExtractVideoNumber() {
  const panelTitle = document.querySelector(".panel-heading .panel-title");
  if (panelTitle) {
    const match = panelTitle.textContent.match(/FC2-PPV-(\d+)/i);
    if (match && match[1]) {
      console.log("自動提取到影片編號：", match[1]);
      return match[1];
    }
  }
  console.log("未能自動提取影片編號");
  return null;
}

document.addEventListener("mouseup", () => {
  if (!sidebarOpen) return;
  const selection = window.getSelection().toString().trim();
  const match = selection.match(/FC2-PPV-(\d+)/i);
  const msgElem = sidebar.querySelector("#fc2-message");
  if (!match) {
    if (msgElem) msgElem.textContent = "請選中影片標題中的 FC2-PPV-xxxxxxx";
    return;
  }
  autoRefreshAll();
});

// ---------------------- Fetch & Update Functions ----------------------

// 從主題圖來源獲取預覽圖（SupJav-Cover → FC2-Cover）
function fetchPreviewSection(videoNumber) {
  // 優先使用 Supjav Cover
  return fetchSupjavCover(videoNumber)
  .catch(error => {
    console.log(`[SupJav-Cover] 失敗，fallback 至 FC2-Cover: ${error.message}`);
    // Fallback 至 FC2 官方 Cover
    return fetchFC2Cover(videoNumber);
  });
}

// 從 Supjav 獲取主題圖
function fetchSupjavCover(videoNumber) {
  const searchUrl = `https://supjav.com/?s=${videoNumber}`;
  return sendMessageFetch("FETCH_SUPJAV", { searchUrl })
  .then(htmlText => {
    const doc = parseHtml(htmlText);
    const firstResult = doc.querySelector("a.img img");
    if (firstResult) {
      let src = firstResult.getAttribute("data-original") || firstResult.getAttribute("src");
      if (!src) throw new Error("未找到圖片 src");
      
      // 去掉 resize 參數
      src = src.replace(/!\d+x\d+\.jpg$/i, "");
      if (src.startsWith("//")) src = "https:" + src;
      
      // 檢查圖片可用性
      return new Promise((resolveImg, rejectImg) => {
        const testImg = new Image();
        testImg.onload = () => {
          const previewHtml = `
            <div class="fc2-preview-container">
              <img src="${src}" alt="${videoNumber}" style="max-width: 100%; height: auto;">
            </div>
          `;
          console.log("成功從 SupJav-Cover 獲取主題圖");
          resolveImg(previewHtml);
        };
        testImg.onerror = () => rejectImg(new Error("SupJav-Cover 圖片載入失敗"));
        testImg.src = src;
        
        setTimeout(() => {
          if (!testImg.complete) rejectImg(new Error("SupJav-Cover 圖片載入超時"));
        }, 1200);
      });
    }
    throw new Error("Supjav 未找到搜尋結果");
  });
}

// 從 FC2 官方獲取主題圖
function fetchFC2Cover(videoNumber) {
  return sendMessageFetch("FETCH_PREVIEW_OFFICIAL", { videoNumber })
  .then(htmlText => {
    const doc = parseHtml(htmlText);
    const mainThumb = doc.querySelector("div.items_article_MainitemThumb");
    if (!mainThumb) throw new Error("未找到 FC2 官方主題圖");
    
    const img = mainThumb.querySelector("img");
    if (!img) throw new Error("未找到圖片元素");
    
    let src = img.getAttribute("src");
    if (src.startsWith("//")) src = "https:" + src;
    
    // 檢查圖片可用性
    return new Promise((resolveImg, rejectImg) => {
      const testImg = new Image();
      testImg.onload = () => {
        const duration = mainThumb.querySelector(".items_article_info")?.textContent || "";
        const previewHtml = `
          <div class="fc2-preview-container">
            <img src="${src}" alt="${videoNumber}" style="max-width: 100%; height: auto;">
            ${duration ? `<div class="duration">${duration}</div>` : ""}
          </div>
        `;
        console.log("成功從 FC2-Cover 獲取主題圖");
        resolveImg(previewHtml);
      };
      testImg.onerror = () => rejectImg(new Error("FC2-Cover 圖片載入失敗"));
      testImg.src = src;
      
      setTimeout(() => {
        if (!testImg.complete) rejectImg(new Error("FC2-Cover 圖片載入超時"));
      }, 1200);
    });
  })
  .catch(error => {
    console.error("FC2-Cover 提取失敗：", error);
    return `Error: ${error.message}`;
  });
}

function updatePreviewSection(html) {
  const elem = sidebar.querySelector("#fc2-preview");
  if (elem) elem.innerHTML = html;
}

// 從 FC2 官方頁面抓取 Sample Images（前6張）
function fetchOfficialPreviewSection(videoNumber) {
  return sendMessageFetch("FETCH_PREVIEW_OFFICIAL", { videoNumber })
  .then(htmlText => {
    const doc = parseHtml(htmlText);
    const section = doc.querySelector("section.items_article_SampleImages");
    if (section) {
      const ul = section.querySelector("ul.items_article_SampleImagesArea");
      if (ul) {
        const liItems = Array.from(ul.querySelectorAll("li")).slice(0, 6);
        const newUl = document.createElement("ul");
        newUl.className = ul.className;
        if (ul.hasAttribute("data-feed")) {
          newUl.setAttribute("data-feed", ul.getAttribute("data-feed"));
        }
        liItems.forEach(li => newUl.appendChild(li.cloneNode(true)));
        const newSection = document.createElement("section");
        newSection.className = section.className;
        const h3 = section.querySelector("h3");
        if (h3) newSection.appendChild(h3.cloneNode(true));
        newSection.appendChild(newUl);
        console.log("成功提取官方 Sample Images：", newSection.outerHTML);
        return newSection.outerHTML;
      }
      throw new Error("未找到官方預覽圖片列表");
    }
    throw new Error("官方 Sample Images Section 未找到");
  })
  .catch(error => {
    console.error("提取或解析 FC2 官方頁面錯誤：", error);
    return `Error: ${error.message}`;
  });
}

function updateOfficialPreviewSection(html) {
  const elem = sidebar.querySelector("#fc2-preview-official");
  if (elem) elem.innerHTML = html;
}

// 從 fc2ppvdb 影片頁面提取影片資訊，提取女優資訊
function fetchVideoInfo(videoNumber) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "FETCH_VIDEO_INFO", videoNumber }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      response && response.success ? resolve(response.html) : reject(new Error(response ? response.error : "Unknown error"));
    });
  })
  .then(htmlText => {
    return extractActressData(htmlText);
  })
  .catch(error => {
    console.error("提取或解析影片資訊錯誤：", error);
    return `Error: ${error.message}`;
  });
}

// 從影片資訊 HTML 中提取女優資訊
function extractActressData(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  // 優先使用最穩定的 data-actress 屬性
  const actressLink = doc.querySelector("a.artistUrl[data-actress]") || 
                      doc.querySelector("h3.artist-name a");
  
  if (!actressLink) return "Error: 未找到女優資訊";
  
  const actressName = actressLink.textContent.trim();
  let actressUrl = actressLink.getAttribute("href");
  if (actressUrl && actressUrl.startsWith("/")) {
    actressUrl = "https://fd2ppv.cc" + actressUrl;
  }
  return { actressName, actressUrl };
}

function updateVideoInfo(actressData) {
  const infoElem = sidebar.querySelector("#fc2-info");
  if (!infoElem) return;
  if (typeof actressData === "string" && actressData.startsWith("Error:")) {
    infoElem.innerHTML = actressData;
    return;
  }
  // 只顯示女優名稱（純文字），不附連結
  infoElem.innerHTML = `<div>女優：${actressData.actressName}</div>
    <h4>相關影片</h4>
    <div id="fc2-related-videos"><p>正在提取相關影片...</p></div>`;
  // 從女優頁面提取相關影片
  fetchRelatedVideos(actressData.actressUrl).then(relatedHtml => {
    updateRelatedVideos(relatedHtml);
  });
}

// 從女優頁面提取最新相關影片，生成動態 Table（最多顯示18個），只顯示影片番號
function fetchRelatedVideos(actressUrl) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "FETCH_RELATED_VIDEOS", actressUrl }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      response && response.success ? resolve(response.html) : reject(new Error(response ? response.error : "Unknown error"));
    });
  })
  .then(htmlText => {
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    // 鎖定 Grid 內的項目
    const items = doc.querySelectorAll(".other-works-grid .other-work-item");
    
    let videos = [];
    items.forEach(item => {
      // 在項目內尋找 Title 或是直接尋找連結文字
      const titleEl = item.querySelector(".other-work-title");
      if (titleEl) {
        const text = titleEl.textContent.trim();
        // 改良的正則：尋找 FC2-PPV- 後面的數字，或純 7 位數字
        const match = text.match(/(\d{5,8})/); 
        if (match) videos.push(match[1]);
      }
    });

    // 移除重複並限制數量
    videos = [...new Set(videos)].slice(0, 18);
    
    if (videos.length === 0) return "Error: 未找到任何相關影片編號";

    // 建立表格 (保持原本的 Table 生成代碼)
    let tableHtml = `<table style="width:100%; border-collapse: collapse;"><tbody>`;
    for (let i = 0; i < videos.length; i++) {
      if (i % 3 === 0) tableHtml += `<tr>`;
      const videoNum = videos[i];
      const searchUrl = `https://sukebei.nyaa.si/?f=0&c=0_0&q=FC2+${videoNum}`;
      tableHtml += `<td data-videonum="${videoNum}" style="border: 1px solid #ccc; text-align: center; padding: 5px; cursor: pointer; font-size: 12px;" onclick="window.open('${searchUrl}', '_blank')">${videoNum}</td>`;
      if (i % 3 === 2) tableHtml += `</tr>`;
    }      
    if (videos.length % 3 !== 0) tableHtml += `</tr>`;
    tableHtml += `</tbody></table>`;
    return tableHtml;
  })
  .catch(error => `Error: ${error.message}`);
}

function updateRelatedVideos(html) {
  const infoElem = sidebar.querySelector("#fc2-info");
  if (!infoElem) return;
  let relatedContainer = infoElem.querySelector("#fc2-related-videos");
  if (!relatedContainer) {
    relatedContainer = document.createElement("div");
    relatedContainer.id = "fc2-related-videos";
    infoElem.appendChild(relatedContainer);
  }
  relatedContainer.innerHTML = html;
  
  // 確保在更新內容後立即設置懸浮事件
  setTimeout(() => {
    setupHoverEvents();
    console.log("已設置懸浮預覽事件");
  }, 100);
}

// 新增 Hover 預覽功能：全局緩存與請求去重
const previewCache = {};
const inflightRequests = {}; // 追蹤進行中的請求，避免重複

// 從 Supjav 搜尋頁面獲取預覽圖
function fetchSupjavPreviewImage(videoNumber) {
  const searchUrl = `https://supjav.com/?s=${videoNumber}`;
  return sendMessageFetch("FETCH_SUPJAV", { searchUrl })
  .then(htmlText => {
    const doc = parseHtml(htmlText);
    const firstResult = doc.querySelector("a.img img");
    if (firstResult) {
      let src = firstResult.getAttribute("data-original") || firstResult.getAttribute("src");
      if (!src) throw new Error("未找到圖片 src");
      
      // 去掉 resize 參數 (!320x216.jpg)
      src = src.replace(/!\d+x\d+\.jpg$/i, "");
      
      // 確保 https
      if (src.startsWith("//")) src = "https:" + src;
      
      // 檢查圖片可用性
      return new Promise((resolveImg, rejectImg) => {
        const testImg = new Image();
        testImg.onload = () => resolveImg(src);
        testImg.onerror = () => rejectImg(new Error("Supjav 圖片載入失敗"));
        testImg.src = src;
        
        setTimeout(() => {
          if (!testImg.complete) rejectImg(new Error("Supjav 圖片載入超時"));
        }, 5000);
      });
    }
    throw new Error("Supjav 未找到搜尋結果");
  });
}

function fetchPreviewImageSrc(videoNumber) {
  // Hover 預覽優先使用 Supjav（速度快）
  return fetchSupjavPreviewImage(videoNumber)
  .catch(error => {
    console.log(`[Supjav] 獲取失敗，fallback 至官方: ${error.message}`);
    // Fallback 至官方網站
    return sendMessageFetch("FETCH_PREVIEW_OFFICIAL", { videoNumber })
    .then(htmlText => {
      const doc = parseHtml(htmlText);
      const mainThumb = doc.querySelector("div.items_article_MainitemThumb img");
      if (mainThumb) {
        let src = mainThumb.getAttribute("src");
        if (src.startsWith("//")) src = "https:" + src;
        
        return new Promise((resolveImg, rejectImg) => {
          const testImg = new Image();
          testImg.onload = () => resolveImg(src);
          testImg.onerror = () => rejectImg(new Error("官方圖片載入失敗"));
          testImg.src = src;
          
          setTimeout(() => {
            if (!testImg.complete) rejectImg(new Error("官方圖片載入超時"));
          }, 5000);
        });
      }
      throw new Error("未找到官方預覽圖");
    });
  });
}

function showHoverPreview(videoNum, event) {
  // 已有快取，直接顯示
  if (previewCache[videoNum]) {
    displayHoverPreview(previewCache[videoNum], event);
    return;
  }
  
  // 檢查是否正在請求中（避免重複請求）
  if (inflightRequests[videoNum]) {
    displayLoadingPreview(event);
    return;
  }
  
  // 標記為請求中
  inflightRequests[videoNum] = true;
  displayLoadingPreview(event);
  
  fetchPreviewImageSrc(videoNum)
    .then(src => {
      previewCache[videoNum] = src;
      delete inflightRequests[videoNum];
      // 只在 hover div 還存在且顯示中才更新
      const hoverDiv = document.getElementById("hover-preview");
      if (hoverDiv && hoverDiv.style.display === "block") {
        displayHoverPreview(src, event);
      }
    })
    .catch(error => {
      console.error(`獲取預覽圖失敗 (${videoNum}):`, error);
      previewCache[videoNum] = null; // 記錄失敗，避免重試
      delete inflightRequests[videoNum];
      const hoverDiv = document.getElementById("hover-preview");
      if (hoverDiv && hoverDiv.style.display === "block") {
        displayErrorPreview(event);
      }
    });
}

function displayLoadingPreview(event) {
  let hoverDiv = document.getElementById("hover-preview");
  if (!hoverDiv) {
    hoverDiv = document.createElement("div");
    hoverDiv.id = "hover-preview";
    document.body.appendChild(hoverDiv);
  }
  hoverDiv.innerHTML = `<div class="preview-loading">載入中...</div>`;
  hoverDiv.style.left = (event.pageX + 10) + "px";
  hoverDiv.style.top = (event.pageY + 10) + "px";
  hoverDiv.style.display = "block";
}

function displayErrorPreview(event) {
  let hoverDiv = document.getElementById("hover-preview");
  if (hoverDiv) {
    hoverDiv.innerHTML = `<div class="preview-error">無法載入預覽圖</div>`;
  }
}

function displayHoverPreview(src, event) {
  let hoverDiv = document.getElementById("hover-preview");
  if (!hoverDiv) {
    hoverDiv = document.createElement("div");
    hoverDiv.id = "hover-preview";
    // 樣式由 CSS 控制
    document.body.appendChild(hoverDiv);
  }
  hoverDiv.innerHTML = `<img src="${src}" alt="" />`;
  hoverDiv.style.left = (event.pageX + 10) + "px";
  hoverDiv.style.top = (event.pageY + 10) + "px";
  hoverDiv.style.display = "block";
}

function hideHoverPreview() {
  const hoverDiv = document.getElementById("hover-preview");
  if (hoverDiv) {
    hoverDiv.style.display = "none";
  }
}

// 為相關影片的表格 td 添加 hover 事件
function setupHoverEvents() {
  const cells = sidebar.querySelectorAll("#fc2-related-videos td[data-videonum]");
  console.log("找到的相關影片單元格數量：", cells.length);
  
  cells.forEach(cell => {
    const videoNum = cell.getAttribute("data-videonum");
    console.log("設置懸浮事件，影片編號：", videoNum);
    
    cell.addEventListener("mouseover", (e) => {
      console.log("觸發 mouseover 事件，影片編號：", videoNum);
      showHoverPreview(videoNum, e);
    });
    
    cell.addEventListener("mousemove", (e) => {
      let hoverDiv = document.getElementById("hover-preview");
      if (hoverDiv && hoverDiv.style.display === "block") {
        hoverDiv.style.left = (e.pageX + 10) + "px";
        hoverDiv.style.top = (e.pageY + 10) + "px";
      }
    });
    
    cell.addEventListener("mouseout", () => {
      console.log("觸發 mouseout 事件，影片編號：", videoNum);
      hideHoverPreview();
    });
  });
}
