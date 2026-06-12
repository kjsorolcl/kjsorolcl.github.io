(function () {
  "use strict";

  const DIGBOY = {
    version: "1.0.0",
    patchedSwfUrl: "/swf/digboy/digboy_save_v1.swf",
    proxyPath: "/digboy_save_proxy",
    serviceWorkerUrl: "/digboy_save_sw.js",
    localStorageKey: "flashgame_mobile:digboy:save_payload:v1",
    metaStorageKey: "flashgame_mobile:digboy:save_meta:v1",
    dbName: "flashgame-mobile-digboy-save",
    dbVersion: 1,
    dbStore: "kv",
    payloadKey: "save_payload_v1",
    metaKey: "save_meta_v1",
    allowedOrigins: [
      "https://gamejit.com",
      "https://flash-game-house.tistory.com",
      "https://memoryarchive.blog",
      "https://www.memory-finder.com",
      "https://kjsorolcl.github.io"
    ],
    appUserAgentMarkers: [
      "FlashGameMobileApp/com.kjs.fgplayer",
      "FlashGameMobileApp",
      "com.kjs.fgplayer"
    ],
    serviceWorkerReloadKey: "flashgame_mobile:digboy:sw_controller_reload:v1",
    digboyUrlPatterns: [
      /digboy/i,
      /gulchak/i,
      /goon/i,
      /K_F_DIGBOY/i,
      /FSADIGBOY/i,
      /굴착소년/i,
      /%EA%B5%B4%EC%B0%A9%EC%86%8C%EB%85%84/i
    ],
    digboyTitlePatterns: [
      /굴착소년\s*쿵/i,
      /굴착소년/i,
      /digboy/i,
      /goon/i
    ]
  };

  let prepared = false;
  let bridgeEnabled = false;
  let lastPrepareResult = null;

  function log(message, details) {
    if (!window.FlashGameMobileDigboyDebug) return;
    if (details === undefined) {
      console.log("[DigboySave]", message);
    } else {
      console.log("[DigboySave]", message, details);
    }
  }

  function absoluteUrl(url) {
    return new URL(String(url || ""), window.location.href).href;
  }

  function parseParams(paramsLike) {
    if (!paramsLike) return {};
    if (paramsLike instanceof URLSearchParams) {
      const out = {};
      for (const [key, value] of paramsLike.entries()) out[key] = value;
      return out;
    }
    return paramsLike;
  }

  function isAllowedOrigin() {
    return DIGBOY.allowedOrigins.includes(window.location.origin);
  }

  function appIdentityFromBridge() {
    try {
      const app = window.FlashGameMobileApp || window.flashGameMobileApp || null;
      if (app && app.packageName === "com.kjs.fgplayer") return true;
      if (app && app.bundleId === "com.kjs.fgplayer") return true;
      if (app && app.name === "Flash Game Mobile") return true;
    } catch (_) {
    }
    return false;
  }

  function isAllowedAppWebView() {
    const ua = navigator.userAgent || "";
    const uaAllowed = DIGBOY.appUserAgentMarkers.some((marker) => ua.indexOf(marker) >= 0);
    const bridgeAllowed = appIdentityFromBridge();
    return uaAllowed || bridgeAllowed;
  }

  function isAllowedEnvironment() {
    return isAllowedOrigin() || isAllowedAppWebView();
  }

  function containsPattern(value, patterns) {
    const text = String(value || "");
    return patterns.some((pattern) => pattern.test(text));
  }

  function isDigboyGame(rawUrl, paramsLike) {
    const params = parseParams(paramsLike);
    const checks = [
      rawUrl,
      params.url,
      params.swf,
      params.gameid,
      params.gameId,
      params.docId,
      params.docid,
      params.title,
      params.name
    ];
    return checks.some((value) => containsPattern(value, DIGBOY.digboyUrlPatterns)) ||
      containsPattern(params.title, DIGBOY.digboyTitlePatterns) ||
      containsPattern(document.title, DIGBOY.digboyTitlePatterns);
  }

  function isProxyEndpoint(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), window.location.href);
      return url.pathname === DIGBOY.proxyPath ||
        /\/gamepack\/game\/save\.nhn$/i.test(url.pathname) && /(?:^|\.)packgoon\.hangame\.com$/i.test(url.hostname);
    } catch (_) {
      return /digboy_save_proxy/i.test(String(rawUrl || "")) ||
        /packgoon\.hangame\.com\/gamepack\/game\/save\.nhn/i.test(String(rawUrl || ""));
    }
  }

  function upgradeAllowedAssetUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), window.location.href);
      if (window.location.protocol === "https:" &&
        url.protocol === "http:" &&
        url.hostname === "kjsorolcl.github.io") {
        url.protocol = "https:";
        return url.href;
      }
    } catch (_) {
    }
    return rawUrl;
  }

  function loadVarsValue(payload) {
    return String(payload || "")
      .replace(/\+/g, "%2B")
      .replace(/&/g, "%26")
      .replace(/=/g, "%3D");
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DIGBOY.dbName, DIGBOY.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DIGBOY.dbStore)) db.createObjectStore(DIGBOY.dbStore);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DIGBOY.dbStore, "readonly");
      const req = tx.objectStore(DIGBOY.dbStore).get(key);
      req.onsuccess = () => resolve(req.result || "");
      req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB transaction failed"));
      };
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DIGBOY.dbStore, "readwrite");
      const req = tx.objectStore(DIGBOY.dbStore).put(String(value || ""), key);
      req.onerror = () => reject(req.error || new Error("IndexedDB put failed"));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB transaction failed"));
      };
    });
  }

  async function writePayload(payload, meta) {
    const text = String(payload || "");
    try {
      localStorage.setItem(DIGBOY.localStorageKey, text);
      localStorage.setItem(DIGBOY.metaStorageKey, JSON.stringify(meta || {}));
    } catch (error) {
      log("localStorage write failed", String(error));
    }
    try {
      await idbSet(DIGBOY.payloadKey, text);
      await idbSet(DIGBOY.metaKey, JSON.stringify(meta || {}));
    } catch (error) {
      log("IndexedDB write failed", String(error));
    }
    notifyApp("save", { payloadLength: text.length, meta: meta || {} });
    return text.length > 0;
  }

  function mirrorPayloadToLocalStorage(payload, meta) {
    try {
      localStorage.setItem(DIGBOY.localStorageKey, String(payload || ""));
      localStorage.setItem(DIGBOY.metaStorageKey, JSON.stringify(meta || {}));
    } catch (error) {
      log("localStorage mirror failed", String(error));
    }
  }

  async function readPayload() {
    try {
      const payload = await idbGet(DIGBOY.payloadKey);
      if (payload) return String(payload);
    } catch (error) {
      log("IndexedDB read failed", String(error));
    }
    try {
      return localStorage.getItem(DIGBOY.localStorageKey) || "";
    } catch (error) {
      log("localStorage read failed", String(error));
    }
    return "";
  }

  function notifyApp(type, data) {
    const message = { type, game: "digboy", version: DIGBOY.version, data: data || {} };
    try {
      if (window.flutter_inappwebview && window.flutter_inappwebview.callHandler) {
        window.flutter_inappwebview.callHandler("FlashGameMobileDigboySave", message);
      }
    } catch (_) {
    }
    try {
      if (window.FlashGameMobileApp && typeof window.FlashGameMobileApp.onDigboySaveEvent === "function") {
        window.FlashGameMobileApp.onDigboySaveEvent(message);
      }
    } catch (_) {
    }
  }

  async function bodyToText(body) {
    if (!body) return "";
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return new URLSearchParams(body).toString();
    if (body instanceof Blob) return await body.text();
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
    if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
    return String(body);
  }

  function responseText(text, contentType) {
    return new Response(String(text || ""), {
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": contentType || "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  async function localProxyResponse(rawUrl, method, bodyText) {
    if (!bridgeEnabled) return responseText("data=", "application/x-www-form-urlencoded; charset=utf-8");
    try {
      const fields = new URLSearchParams(String(bodyText || ""));
      const m = fields.get("m") || "";
      const gameid = fields.get("gameid") || "";
      const data = fields.get("data") || "";
      if (m === "uprat" || data) {
        const ok = await writePayload(data, {
          savedAt: new Date().toISOString(),
          url: String(rawUrl || ""),
          method: method || "POST",
          m,
          gameid,
          payloadLength: data.length
        });
        log("save request handled", { ok, payloadLength: data.length });
        return responseText(ok ? "OK" : "ERROR", "text/plain; charset=utf-8");
      }
      if (m === "selrat" || new URL(String(rawUrl || ""), window.location.href).searchParams.has("cache")) {
        const payload = await readPayload();
        const body = `data=${loadVarsValue(payload)}`;
        log("load request handled", { found: Boolean(payload), payloadLength: payload.length });
        return responseText(body, "application/x-www-form-urlencoded; charset=utf-8");
      }
      return responseText("data=", "application/x-www-form-urlencoded; charset=utf-8");
    } catch (error) {
      log("local proxy error", String(error));
      return responseText("data=", "application/x-www-form-urlencoded; charset=utf-8");
    }
  }

  function installJsInterceptors() {
    if (window.__digboySaveJsInterceptorsInstalled) return;
    window.__digboySaveJsInterceptorsInstalled = true;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function (resource, init) {
      const url = typeof resource === "string" ? resource : resource && resource.url;
      if (!bridgeEnabled || !isProxyEndpoint(url)) {
        const upgradedUrl = upgradeAllowedAssetUrl(url);
        if (upgradedUrl !== url) return nativeFetch(upgradedUrl, init);
        return nativeFetch(resource, init);
      }
      const method = init && init.method || resource && resource.method || "POST";
      const body = init && init.body ? await bodyToText(init.body) :
        resource instanceof Request ? await resource.clone().text().catch(() => "") : "";
      return localProxyResponse(url, method, body);
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      const upgradedUrl = upgradeAllowedAssetUrl(url);
      this.__digboyRequest = { method, url: upgradedUrl };
      arguments[1] = upgradedUrl;
      return nativeOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const req = this.__digboyRequest || {};
      if (!bridgeEnabled || !isProxyEndpoint(req.url)) return nativeSend.apply(this, arguments);
      const xhr = this;
      const deliver = (text) => {
        try { Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 }); } catch (_) {}
        try { Object.defineProperty(xhr, "status", { configurable: true, value: 200 }); } catch (_) {}
        try { Object.defineProperty(xhr, "statusText", { configurable: true, value: "OK" }); } catch (_) {}
        try { Object.defineProperty(xhr, "response", { configurable: true, value: text }); } catch (_) {}
        try { Object.defineProperty(xhr, "responseText", { configurable: true, value: text }); } catch (_) {}
        xhr.dispatchEvent(new Event("readystatechange"));
        if (xhr.onreadystatechange) xhr.onreadystatechange();
        xhr.dispatchEvent(new Event("load"));
        if (xhr.onload) xhr.onload();
        xhr.dispatchEvent(new Event("loadend"));
        if (xhr.onloadend) xhr.onloadend();
      };
      bodyToText(body)
        .then((bodyText) => localProxyResponse(req.url, req.method || "POST", bodyText))
        .then((response) => response.text())
        .then(deliver)
        .catch(() => deliver("data="));
    };
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return false;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return false;
    }
    try {
      const registration = await navigator.serviceWorker.register(DIGBOY.serviceWorkerUrl, { scope: "/" });
      await registration.update().catch(() => {});
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (!done) {
              done = true;
              resolve();
            }
          };
          navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
          setTimeout(finish, 800);
        });
      }
      if (!navigator.serviceWorker.controller) {
        let alreadyReloaded = false;
        try {
          alreadyReloaded = sessionStorage.getItem(DIGBOY.serviceWorkerReloadKey) === "1";
        } catch (_) {
        }
        if (!alreadyReloaded) {
          try {
            sessionStorage.setItem(DIGBOY.serviceWorkerReloadKey, "1");
          } catch (_) {
          }
          window.location.reload();
          return "reloading";
        }
      } else {
        try {
          sessionStorage.removeItem(DIGBOY.serviceWorkerReloadKey);
        } catch (_) {
        }
      }
      return true;
    } catch (error) {
      log("service worker registration failed", String(error));
      return false;
    }
  }

  function installServiceWorkerMessageMirror() {
    if (!("serviceWorker" in navigator) || window.__digboySaveSwMirrorInstalled) return;
    window.__digboySaveSwMirrorInstalled = true;
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.source !== "digboy-save-sw") return;
      if (data.type === "save") {
        mirrorPayloadToLocalStorage(data.payload || "", data.meta || {});
        notifyApp("save", {
          payloadLength: String(data.payload || "").length,
          meta: data.meta || {}
        });
      }
    });
  }

  function ruffleConfigPatch() {
    return {
      allowNetworking: "all",
      openUrlMode: "deny",
      upgradeToHttps: false,
      urlRewriteRules: [
        [/^https?:\/\/(?:alpha-)?packgoon\.hangame\.com\/gamepack\/game\/save\.nhn(\?.*)?$/i, `${DIGBOY.proxyPath}$1`],
        [/^http:\/\/kjsorolcl\.github\.io\/(.+)$/i, "https://kjsorolcl.github.io/$1"]
      ]
    };
  }

  async function prepare(originalSwfUrl, options) {
    const opts = options || {};
    const params = parseParams(opts.params);
    const allowedEnvironment = isAllowedEnvironment();
    const digboyGame = isDigboyGame(originalSwfUrl, params);
    bridgeEnabled = Boolean(allowedEnvironment && digboyGame);
    lastPrepareResult = {
      enabled: bridgeEnabled,
      reason: bridgeEnabled ? "enabled" : (!digboyGame ? "not_digboy" : "environment_not_allowed"),
      originalUrl: originalSwfUrl,
      url: originalSwfUrl,
      allowedOrigin: isAllowedOrigin(),
      allowedApp: isAllowedAppWebView()
    };
    if (!bridgeEnabled) {
      log("digboy save bridge disabled", lastPrepareResult);
      return lastPrepareResult;
    }

    if (!prepared) {
      installJsInterceptors();
      installServiceWorkerMessageMirror();
      const swReady = await registerServiceWorker();
      if (swReady === "reloading") {
        return await new Promise(() => {});
      }
      prepared = true;
      log("digboy save bridge prepared", { swReady });
    }

    lastPrepareResult.url = absoluteUrl(opts.patchedSwfUrl || DIGBOY.patchedSwfUrl);
    lastPrepareResult.proxyPath = DIGBOY.proxyPath;
    return lastPrepareResult;
  }

  window.FlashGameMobileDigboySave = {
    config: DIGBOY,
    prepare,
    isDigboyGame,
    isAllowedEnvironment,
    ruffleConfigPatch,
    readPayload,
    writePayload,
    getLastPrepareResult: () => lastPrepareResult
  };
})();
