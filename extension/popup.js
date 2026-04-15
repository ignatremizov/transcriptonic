// @ts-check
/// <reference path="../types/chrome.d.ts" />
/// <reference path="../types/index.js" />

window.onload = function () {
  const autoModeRadio = document.querySelector("#auto-mode")
  const manualModeRadio = document.querySelector("#manual-mode")
  const versionElement = document.querySelector("#version")
  // const notice = document.querySelector("#notice")


  // Platform Checkboxes
  const googleMeetToggle = /** @type {HTMLInputElement} */ (document.querySelector("#enable-google-meet"))
  const teamsToggle = /** @type {HTMLInputElement} */ (document.querySelector("#enable-teams"))
  const zoomToggle = /** @type {HTMLInputElement} */ (document.querySelector("#enable-zoom"))

  if (autoModeRadio instanceof HTMLInputElement) {
    autoModeRadio.checked = true
  }
  if (googleMeetToggle) {
    googleMeetToggle.checked = true
  }

  if (versionElement) {
    versionElement.innerHTML = `v${chrome.runtime.getManifest().version}`
  }

  chrome.storage.sync.get(["operationMode", "wantGoogleMeet", "wantTeams", "wantZoom"], function (resultSyncUntyped) {
    const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

    chrome.storage.sync.set({
      operationMode: resultSync.operationMode === "manual" ? "manual" : "auto",
      wantGoogleMeet: resultSync.wantGoogleMeet === false ? false : true,
      wantTeams: resultSync.wantTeams === true ? true : false,
      wantZoom: resultSync.wantZoom === true ? true : false,
    }, function () { })

    if (autoModeRadio instanceof HTMLInputElement && manualModeRadio instanceof HTMLInputElement) {
      if (resultSync.operationMode === "manual") {
        manualModeRadio.checked = true
      }
      else {
        autoModeRadio.checked = true
      }

      autoModeRadio.addEventListener("change", function () {
        chrome.storage.sync.set({ operationMode: "auto" }, function () { })
      })
      manualModeRadio.addEventListener("change", function () {
        chrome.storage.sync.set({ operationMode: "manual" }, function () { })
      })
    }

    if (googleMeetToggle) {
      googleMeetToggle.checked = resultSync.wantGoogleMeet === false ? false : true
    }
    if (teamsToggle) {
      teamsToggle.checked = resultSync.wantTeams === true
    }
    if (zoomToggle) {
      zoomToggle.checked = resultSync.wantZoom === true
    }
  })

  /**
   * Syncs checkbox UI with actual background script registration status
   * @param {HTMLInputElement} element 
   * @param {Platform} platform 
   */
  function syncPlatformStatus(element, platform) {
    const storageKeyByPlatform = {
      google_meet: "wantGoogleMeet",
      teams: "wantTeams",
      zoom: "wantZoom"
    }
    const storageKey = storageKeyByPlatform[platform]

    /** @type {ExtensionMessage} */
    const message = {
      type: "get_platform_status",
      platform: platform
    }
    chrome.runtime.sendMessage(message, (responseUntyped) => {
      const response = /** @type {ExtensionResponse} */ (responseUntyped)
      if (response && response.success) {
        element.checked = response.message === "Enabled"
      }
    })

    element.addEventListener("change", () => {
      const type = element.checked ? "enable_platform" : "disable_platform"
      const desiredState = element.checked

      chrome.storage.sync.set({ [storageKey]: desiredState }, function () { })

      /** @type {ExtensionMessage} */
      const message = {
        type: type,
        platform: platform
      }
      chrome.runtime.sendMessage(message, (responseUntyped) => {
        const response = /** @type {ExtensionResponse} */ (responseUntyped)
        if (response?.success) {
          chrome.storage.sync.set({ [storageKey]: desiredState }, function () { })
        }
        else {
          element.checked = !element.checked // Revert on failure
          chrome.storage.sync.set({ [storageKey]: element.checked }, function () { })
          console.error(`Failed to toggle ${platform}:`, response?.message)
        }
      })
    })
  }

  // Initialize Toggles
  if (googleMeetToggle) {
    syncPlatformStatus(googleMeetToggle, "google_meet")
  }
  if (teamsToggle) {
    syncPlatformStatus(teamsToggle, "teams")
  }
  if (zoomToggle) {
    syncPlatformStatus(zoomToggle, "zoom")
  }

  // notice?.addEventListener("click", () => {
  //   alert("The transcript may not always be accurate and is only intended to aid in improving productivity. It is the responsibility of the user to ensure they comply with any applicable laws/rules.")
  // })
}
