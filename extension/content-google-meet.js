// @ts-check
/// <reference path="../types/chrome.d.ts" />
/// <reference path="../types/index.js" />


//*********** GLOBAL VARIABLES **********//
/** @type {ExtensionStatusJSON} */
const extensionStatusJSON_bug = {
  "status": 400,
  "message": `<strong>TranscripTonic encountered a new error</strong> <br /> Please report it <a href="https://github.com/vivek-nexus/transcriptonic/issues" target="_blank">here</a>.`
}

const reportErrorMessage = "There is a bug in TranscripTonic. Please report it at https://github.com/vivek-nexus/transcriptonic/issues"
/** @type {MutationObserverInit} */
const mutationConfig = { childList: true, attributes: true, subtree: true, characterData: true }
const captionsContainerSelectors = [
  `div[role="region"][aria-label="Captions"]`,
  `div[role="region"][aria-label*="Caption"]`,
  `div[role="region"][aria-label*="caption"]`,
  ".iOzk7",
  `div[role="region"][tabindex="0"]`
]
const captionSpeakerSelector = ".nMcdL.bj4p3b, .nMcdL"
const captionTextSelector = ".ygicle.VbkSU, .ygicle"
const captionSpeakerNameSelector = ".NWpY1d, .KcIKyf.jxFHg, .KcIKyf"
const captionButtonSelector = `button[jsname="r8qRAd"], button[aria-label*="caption" i], button[aria-label*="자막"], button[aria-label*="字幕"]`

// Name of the person attending the meeting
let userName = "You"

// Transcript array that holds one or more transcript blocks
/** @type {TranscriptBlock[]} */
let transcript = []

// Buffer variables to dump values, which get pushed to transcript array as transcript blocks, at defined conditions
/**
   * @type {HTMLElement | null}
   */
let transcriptTargetBuffer
let personNameBuffer = "", transcriptTextBuffer = "", timestampBuffer = ""
let lastActiveTranscriptSaveAt = 0

// Chat messages array that holds one or more chat messages of the meeting
/** @type {ChatMessage[]} */
let chatMessages = []

/** @type {MeetingSoftware} */
const meetingSoftware = "Google Meet"

// Capture meeting start timestamp, stored in ISO format
let meetingStartTimestamp = new Date().toISOString()
let meetingTitle = document.title

// Capture invalid transcript and chatMessages DOM element error for the first time and silence for the rest of the meeting to prevent notification noise
let isTranscriptDomErrorCaptured = false
let isChatMessagesDomErrorCaptured = false

// Capture meeting begin to abort userName capturing interval
let hasMeetingStarted = false

// Capture meeting end to suppress any errors
let hasMeetingEnded = false

/** @type {ExtensionStatusJSON} */
let extensionStatusJSON





// Attempt to recover last meeting, if any. Abort if it takes more than 2 seconds to prevent current meeting getting messed up.
Promise.race([
  recoverLastMeeting(),
  new Promise((_, reject) =>
    setTimeout(() => reject({ errorCode: "016", errorMessage: "Recovery timed out" }), 2000)
  )
]).
  catch((error) => {
    const parsedError = /** @type {ErrorObject} */ (error)
    if ((parsedError.errorCode !== "013") && (parsedError.errorCode !== "014")) {
      console.error(parsedError.errorMessage)
    }
  }).
  finally(() => {
    // Save current meeting data to chrome storage once recovery is complete or is aborted
    overWriteChromeStorage(["meetingSoftware", "meetingStartTimestamp", "meetingTitle", "transcript", "activeTranscriptBlock", "chatMessages"], false)
  })




//*********** MAIN FUNCTIONS **********//
checkExtensionStatus().finally(() => {
  console.log("Extension status " + extensionStatusJSON.status)

  // Enable extension functions only if status is 200
  if (extensionStatusJSON.status === 200) {
    // NON CRITICAL DOM DEPENDENCY. Attempt to get username before meeting starts. Abort interval if valid username is found or if meeting starts and default to "You".
    waitForElement(".awLEm").then(() => {
      // Poll the element until the textContent loads from network or until meeting starts
      const captureUserNameInterval = setInterval(() => {
        if (!hasMeetingStarted) {
          const capturedUserName = document.querySelector(".awLEm")?.textContent
          if (capturedUserName) {
            userName = capturedUserName
            clearInterval(captureUserNameInterval)
          }
        }
        else {
          clearInterval(captureUserNameInterval)
        }
      }, 100)
    })

    // Meet UI post July/Aug 2024
    meetingRoutines(2)
  }
  else {
    // Show downtime message as extension status is 400
    showNotification(extensionStatusJSON)
  }

})


/**
 * @param {number} uiType
 */
function meetingRoutines(uiType) {
  const meetingEndIconData = {
    selector: "",
    text: ""
  }
  const captionsIconData = {
    selector: "",
    text: ""
  }
  // Different selector data for different UI versions
  switch (uiType) {
    case 2:
      meetingEndIconData.selector = ".google-symbols"
      meetingEndIconData.text = "call_end"
      captionsIconData.selector = ".google-symbols"
      captionsIconData.text = "closed_caption_off"
    default:
      break
  }

  // CRITICAL DOM DEPENDENCY. Wait until the meeting end icon appears, used to detect meeting start
  waitForElement(meetingEndIconData.selector, meetingEndIconData.text).then(() => {
    console.log("Meeting started")
    /** @type {ExtensionMessage} */
    const message = {
      type: "new_meeting_started"
    }
    chrome.runtime.sendMessage(message, function () { })
    hasMeetingStarted = true
    // Update meeting startTimestamp
    meetingStartTimestamp = new Date().toISOString()
    overWriteChromeStorage(["meetingStartTimestamp"], false)


    //*********** MEETING START ROUTINES **********//
    updateMeetingTitle()

    /** @type {MutationObserver} */
    let transcriptObserver
    /** @type {MutationObserver} */
    let chatMessagesObserver

    // **** REGISTER TRANSCRIPT AND CHAT MESSAGES LISTENERS **** //
    // REGISTER TRANSCRIPT LISTENER
    // Wait for captions icon to be visible. When user is waiting in meeting lobbing for someone to let them in, the call end icon is visible, but the captions icon is still not visible.
    waitForCaptionsButton(captionsIconData)
      .then(() => {
        // CRITICAL DOM DEPENDENCY
        const captionsButton = getCaptionsButton(captionsIconData)

        // Click captions icon for non manual operation modes. Async operation.
        chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
          const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
          if (resultSync.operationMode === "manual") {
            console.log("Manual mode selected, leaving transcript off")
          }
          else if (captionsButton && !areCaptionsEnabled(captionsButton)) {
            captionsButton.click()
          }
        })

        // Allow DOM to be updated. Once updated, next "then" block will be executed.
        return waitForCaptionsContainer()
      })
      .then((targetNode) => {
        // CRITICAL DOM DEPENDENCY. Grab the transcript element. This element is present, irrespective of captions ON/OFF, so this executes independent of operation mode.
        const transcriptTargetNode = targetNode

        if (transcriptTargetNode) {
          // Create transcript observer instance linked to the callback function. Registered irrespective of operation mode, so that any website transcript can be picked up during the meeting, independent of the operation mode.
          transcriptObserver = new MutationObserver(transcriptMutationCallback)

          // Start observing the transcript element and chat messages element for configured mutations
          transcriptObserver.observe(transcriptTargetNode, mutationConfig)
          watchCaptionsContainerReplacement(transcriptObserver, transcriptTargetNode)

          // Show confirmation message from extensionStatusJSON, once observation has started, based on operation mode
          chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
            const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
            if (resultSync.operationMode === "manual") {
              showNotification({ status: 400, message: "<strong>TranscripTonic is not running</strong> <br /> Turn on captions using the CC icon, if needed" })
            }
            else {
              showNotification(extensionStatusJSON)
            }
          })
        }
        else {
          throw new Error("Transcript element not found in DOM")
        }
      })
      .catch((err) => {
        console.error(err)
        isTranscriptDomErrorCaptured = true
        showNotification(extensionStatusJSON_bug)

        logError("001", err)
      })


    // REGISTER CHAT MESSAGES LISTENER
    // Wait for chat icon to be visible. When user is waiting in meeting lobbing for someone to let them in, the call end icon is visible, but the chat icon is still not visible.
    waitForElement(".google-symbols", "chat")
      .then(() => {
        const chatMessagesButton = selectElements(".google-symbols", "chat")[0]
        // Force open chat messages to make the required DOM to appear. Otherwise, the required chatMessages DOM element is not available.
        chatMessagesButton.click()

        // Allow DOM to be updated. Once updated, next "then" block will be executed.
        return waitForElement(`div[aria-live="polite"].Ge9Kpc`)
          .then(targetNode => ({ targetNode, chatMessagesButton }))
      })
      .then(({ targetNode, chatMessagesButton }) => {
        // Click again to close the chat messages 
        chatMessagesButton.click()
        // CRITICAL DOM DEPENDENCY. Grab the chat messages element. This element is present, irrespective of chat ON/OFF, once it appears for this first time.
        const chatMessagesTargetNode = targetNode

        // Create chat messages observer instance linked to the callback function. Registered irrespective of operation mode.
        if (chatMessagesTargetNode) {
          chatMessagesObserver = new MutationObserver(chatMessagesMutationCallback)
          chatMessagesObserver.observe(chatMessagesTargetNode, mutationConfig)
        }
        else {
          throw new Error("Chat messages element not found in DOM")
        }
      })
      .catch((err) => {
        console.error(err)
        isChatMessagesDomErrorCaptured = true
        showNotification(extensionStatusJSON_bug)

        logError("003", err)
      })

    //*********** MEETING END ROUTINES **********//
    try {
      // CRITICAL DOM DEPENDENCY. Event listener to capture meeting end button click by user
      selectElements(meetingEndIconData.selector, meetingEndIconData.text)[0].parentElement.parentElement.addEventListener("click", () => {
        // To suppress further errors
        hasMeetingEnded = true
        if (transcriptObserver) {
          transcriptObserver.disconnect()
        }
        if (chatMessagesObserver) {
          chatMessagesObserver.disconnect()
        }

        // Push any data in the buffer variables to the transcript array, but avoid pushing blank ones. Needed to handle one or more speaking when meeting ends.
        if ((personNameBuffer !== "") && (transcriptTextBuffer !== "")) {
          pushBufferToTranscript()
        }
        // Save to chrome storage and send message to download transcript from background script
        overWriteChromeStorage(["transcript", "activeTranscriptBlock", "chatMessages"], true)
      })
    } catch (err) {
      console.error(err)
      showNotification(extensionStatusJSON_bug)

      logError("004", err)
    }
  })
}





//*********** CALLBACK FUNCTIONS **********//
/**
 * @description Callback function to execute when transcription mutations are observed.
 * @param {MutationRecord[]} mutationsList
 */
function transcriptMutationCallback(mutationsList) {
  /** @type {Set<Element>} */
  const speakerBlocks = new Set()

  mutationsList.forEach((mutation) => {
    getCaptionSpeakerBlocksFromMutation(mutation).forEach((speakerBlock) => speakerBlocks.add(speakerBlock))
  })

  if (speakerBlocks.size > 0) {
    speakerBlocks.forEach((speakerBlock) => {
      const captionBlock = getCaptionBlockFromSpeakerBlock(speakerBlock)
      if (captionBlock) {
        processTranscriptBlock(captionBlock.personName, captionBlock.transcriptText, captionBlock.captionElement)
      }
    })
    logTranscriptActivity()
    return
  }

  mutationsList.forEach((mutation) => {
    try {
      if (mutation.type === "characterData") {
        const mutationTargetElement = mutation.target.parentElement
        const transcriptUIBlocks = [...mutationTargetElement?.parentElement?.parentElement?.children || []]
        const isLastButSecondElement = transcriptUIBlocks[transcriptUIBlocks.length - 3] === mutationTargetElement?.parentElement ? true : false

        // Pick up only last second element (the last and last but one are non transcript elements), since Meet mutates previous blocks to make minor corrections. Picking them up leads to repetitive transcript blocks in the result.
        if (isLastButSecondElement) {
          const currentPersonName = mutationTargetElement?.previousSibling?.textContent
          const currentTranscriptText = mutationTargetElement?.textContent

          if (currentPersonName && currentTranscriptText) {
            processTranscriptBlock(currentPersonName, currentTranscriptText, transcriptUIBlocks[transcriptUIBlocks.length - 3])
          }
          // No people found in transcript DOM
          else {
            // No transcript yet or the last person stopped speaking(and no one has started speaking next)
            console.log("No active transcript")
            // Push data in the buffer variables to the transcript array, but avoid pushing blank ones.
            if ((personNameBuffer !== "") && (transcriptTextBuffer !== "")) {
              pushBufferToTranscript()
            }
            // Update buffers for the next person in the next mutation
            personNameBuffer = ""
            transcriptTextBuffer = ""
            saveActiveTranscriptBlock(true)
          }
          saveActiveTranscriptBlock(false)
        }
      }

      // Logs to indicate that the extension is working
      logTranscriptActivity()
    } catch (err) {
      console.error(err)
      if (!isTranscriptDomErrorCaptured && !hasMeetingEnded) {
        console.log(reportErrorMessage)
        showNotification(extensionStatusJSON_bug)

        logError("005", err)
      }
      isTranscriptDomErrorCaptured = true
    }
  })
}

/**
 * @description Callback function to execute when chat messages mutations are observed.
 * @param {MutationRecord[]} mutationsList
 */
function chatMessagesMutationCallback(mutationsList) {
  mutationsList.forEach(() => {
    try {
      // CRITICAL DOM DEPENDENCY
      const chatMessagesElement = document.querySelector(`div[aria-live="polite"].Ge9Kpc`)
      // Attempt to parse messages only if at least one message exists
      if (chatMessagesElement && chatMessagesElement.children.length > 0) {
        // CRITICAL DOM DEPENDENCY. Get the last message that was sent/received.
        const chatMessageElement = chatMessagesElement.lastChild?.firstChild?.firstChild?.lastChild
        // CRITICAL DOM DEPENDENCY
        const personAndTimestampElement = chatMessageElement?.firstChild
        const personName = personAndTimestampElement?.childNodes.length === 1 ? userName : personAndTimestampElement?.firstChild?.textContent
        const timestamp = new Date().toISOString()
        // CRITICAL DOM DEPENDENCY
        const chatMessageText = chatMessageElement?.lastChild?.lastChild?.firstChild?.firstChild?.firstChild?.textContent

        if (personName && chatMessageText) {
          /**@type {ChatMessage} */
          const chatMessageBlock = {
            "personName": personName,
            "timestamp": timestamp,
            "chatMessageText": chatMessageText
          }

          // Lot of mutations fire for each message, pick them only once
          pushUniqueChatBlock(chatMessageBlock)
        }
      }
    }
    catch (err) {
      console.error(err)
      if (!isChatMessagesDomErrorCaptured && !hasMeetingEnded) {
        console.log(reportErrorMessage)
        showNotification(extensionStatusJSON_bug)

        logError("006", err)
      }
      isChatMessagesDomErrorCaptured = true
    }
  })
}










//*********** HELPER FUNCTIONS **********//
/**
 * @description Updates the transcript buffer from a speaker/text pair.
 * @param {string} currentPersonName
 * @param {string} currentTranscriptText
 * @param {Element | undefined | null} captionElement
 */
function processTranscriptBlock(currentPersonName, currentTranscriptText, captionElement) {
  if (!currentPersonName || !currentTranscriptText) {
    return
  }

  const normalizedPersonName = normalizeCaptionText(currentPersonName)
  const normalizedTranscriptText = normalizeCaptionText(currentTranscriptText)
  if (!normalizedPersonName || !normalizedTranscriptText) {
    return
  }

  if (captionElement instanceof Element) {
    captionElement.setAttribute("style", "opacity:0.2")
    captionElement.querySelectorAll("*").forEach((item) => {
      if (item instanceof HTMLElement) {
        item.setAttribute("style", "opacity:0.2")
      }
    })
  }

  // Starting fresh in a meeting or resume from no active transcript
  if (transcriptTextBuffer === "") {
    personNameBuffer = normalizedPersonName
    timestampBuffer = new Date().toISOString()
    transcriptTextBuffer = normalizedTranscriptText
  }
  // Some prior transcript buffer exists
  else {
    // New person started speaking
    if (personNameBuffer !== normalizedPersonName) {
      // Push previous person's transcript as a block
      pushBufferToTranscript()

      // Update buffers for next mutation and store transcript block timestamp
      personNameBuffer = normalizedPersonName
      timestampBuffer = new Date().toISOString()
      transcriptTextBuffer = normalizedTranscriptText
    }
    // Same person speaking more
    else {
      // When the same person speaks for more than 30 min (approx), Meet drops very long transcript for current person and starts over, which is detected by current transcript string being significantly smaller than the previous one
      if ((normalizedTranscriptText.length - transcriptTextBuffer.length) < -250) {
        // Push the long transcript
        pushBufferToTranscript()

        // Store transcript block timestamp for next transcript block of same person
        timestampBuffer = new Date().toISOString()
      }

      // Update buffers for next mutation
      if (normalizedTranscriptText !== transcriptTextBuffer) {
        transcriptTextBuffer = normalizedTranscriptText
      }
      else {
        return
      }
    }
  }

  saveActiveTranscriptBlock(false)
}

/**
 * @description Extracts caption speaker blocks from the current Google Meet captions DOM.
 * @param {MutationRecord} mutation
 * @returns {Element[]}
 */
function getCaptionSpeakerBlocksFromMutation(mutation) {
  /** @type {Element[]} */
  const speakerBlocks = []
  const addSpeakerBlock = (node) => {
    const element = node instanceof Element ? node : node.parentElement
    if (!element) {
      return
    }

    const closestSpeakerBlock = element.closest(captionSpeakerSelector)
    if (closestSpeakerBlock && !speakerBlocks.includes(closestSpeakerBlock)) {
      speakerBlocks.push(closestSpeakerBlock)
      return
    }

    element.querySelectorAll(captionSpeakerSelector).forEach((speakerBlock) => {
      if (!speakerBlocks.includes(speakerBlock)) {
        speakerBlocks.push(speakerBlock)
      }
    })
  }

  const captionsContainer = getCaptionsContainer()
  if (captionsContainer?.contains(mutation.target)) {
    const speakerBlocksInContainer = captionsContainer.querySelectorAll(captionSpeakerSelector)
    const speakerBlock = speakerBlocksInContainer[speakerBlocksInContainer.length - 1]
    if (speakerBlock && !speakerBlocks.includes(speakerBlock)) {
      speakerBlocks.push(speakerBlock)
    }
  }

  addSpeakerBlock(mutation.target)
  mutation.addedNodes.forEach(addSpeakerBlock)

  return speakerBlocks
}

/**
 * @param {Element} speakerBlock
 * @returns {{ personName: string, transcriptText: string, captionElement: Element } | null}
 */
function getCaptionBlockFromSpeakerBlock(speakerBlock) {
  const personName = speakerBlock.querySelector(captionSpeakerNameSelector)?.textContent?.trim()
  const captionElement = speakerBlock.querySelector(captionTextSelector) || getLastTextElement(speakerBlock)
  const transcriptText = captionElement?.textContent?.trim()

  if (personName && transcriptText && captionElement) {
    return {
      personName,
      transcriptText,
      captionElement
    }
  }

  return null
}

/**
 * @param {Element} root
 * @returns {Element | null}
 */
function getLastTextElement(root) {
  const candidates = Array.from(root.querySelectorAll("div, span"))
    .filter((element) => normalizeCaptionText(element.textContent || "").length > 0)
  return candidates[candidates.length - 1] || null
}

/**
 * @param {string} value
 */
function normalizeCaptionText(value) {
  return value.replace(/\s+/g, " ").trim()
}

function logTranscriptActivity() {
  if (transcriptTextBuffer.length > 125) {
    console.log(transcriptTextBuffer.slice(0, 50) + "   ...   " + transcriptTextBuffer.slice(-50))
  }
  else {
    console.log(transcriptTextBuffer)
  }
}

/**
 * @description Pushes data in the buffer to transcript array as a transcript block
 */
function pushBufferToTranscript() {
  transcript.push({
    "personName": personNameBuffer === "You" ? userName : personNameBuffer,
    "timestamp": timestampBuffer,
    "transcriptText": transcriptTextBuffer
  })
  overWriteChromeStorage(["transcript"], false)
}

/**
 * @description Pushes object to array only if it doesn't already exist.
 * @param {ChatMessage} chatBlock
 */
function pushUniqueChatBlock(chatBlock) {
  const isExisting = chatMessages.some(item =>
    (item.personName === chatBlock.personName) &&
    (item.chatMessageText === chatBlock.chatMessageText)
  )
  if (!isExisting) {
    console.log(chatBlock)
    chatMessages.push(chatBlock)
    overWriteChromeStorage(["chatMessages"], false)
  }
}

/**
 * @description Saves specified variables to chrome storage. Optionally, can send message to background script to download, post saving.
 * @param {Array<"meetingSoftware"  | "meetingTitle" | "meetingStartTimestamp" | "transcript" | "activeTranscriptBlock" | "chatMessages">} keys
 * @param {boolean} sendDownloadMessage
 */
function overWriteChromeStorage(keys, sendDownloadMessage) {
  const objectToSave = {}
  // Hard coded list of keys that are accepted
  if (keys.includes("meetingSoftware")) {
    objectToSave.meetingSoftware = meetingSoftware
  }
  if (keys.includes("meetingTitle")) {
    objectToSave.meetingTitle = meetingTitle
  }
  if (keys.includes("meetingStartTimestamp")) {
    objectToSave.meetingStartTimestamp = meetingStartTimestamp
  }
  if (keys.includes("transcript")) {
    objectToSave.transcript = transcript
  }
  if (keys.includes("activeTranscriptBlock")) {
    objectToSave.activeTranscriptBlock = getActiveTranscriptBlock()
  }
  if (keys.includes("chatMessages")) {
    objectToSave.chatMessages = chatMessages
  }

  chrome.storage.local.set(objectToSave, function () {
    // Helps people know that the extension is working smoothly in the background
    pulseStatus()
    if (sendDownloadMessage) {
      /** @type {ExtensionMessage} */
      const message = {
        type: "meeting_ended"
      }
      chrome.runtime.sendMessage(message, (responseUntyped) => {
        const response = /** @type {ExtensionResponse} */ (responseUntyped)
        if ((!response.success) && (typeof response.message === 'object') && (response.message?.errorCode === "010")) {
          console.error(response.message.errorMessage)
        }
      })
    }
  })
}

/**
 * @returns {TranscriptBlock | null}
 */
function getActiveTranscriptBlock() {
  if ((personNameBuffer === "") || (transcriptTextBuffer === "")) {
    return null
  }

  return {
    personName: personNameBuffer === "You" ? userName : personNameBuffer,
    timestamp: timestampBuffer || new Date().toISOString(),
    transcriptText: transcriptTextBuffer
  }
}

/**
 * @param {boolean} force
 */
function saveActiveTranscriptBlock(force) {
  const now = Date.now()
  if (!force && ((now - lastActiveTranscriptSaveAt) < 1000)) {
    return
  }
  lastActiveTranscriptSaveAt = now
  chrome.storage.local.set({ activeTranscriptBlock: getActiveTranscriptBlock() }, function () { })
}

/**
 * @description Provides a visual cue to indicate the extension is actively working.
 */
function pulseStatus() {
  const statusActivityCSS = `position: fixed;
    top: 0px;
    width: 100%;
    height: 4px;
    z-index: 100;
    transition: background-color 0.3s ease-in
  `

  /** @type {HTMLDivElement | null}*/
  let activityStatus = document.querySelector(`#transcriptonic-status`)
  if (!activityStatus) {
    let html = document.querySelector("html")
    activityStatus = document.createElement("div")
    activityStatus.setAttribute("id", "transcriptonic-status")
    activityStatus.style.cssText = `background-color: #2A9ACA; ${statusActivityCSS}`
    html?.appendChild(activityStatus)
  }
  else {
    activityStatus.style.cssText = `background-color: #2A9ACA; ${statusActivityCSS}`
  }

  setTimeout(() => {
    activityStatus.style.cssText = `background-color: transparent; ${statusActivityCSS}`
  }, 3000)
}


/**
 * @description Grabs updated meeting title, if available
 */
function updateMeetingTitle() {
  waitForElement(".u6vdEc").then((element) => {
    const meetingTitleElement = /** @type {HTMLDivElement} */ (element)
    meetingTitleElement?.setAttribute("contenteditable", "true")
    meetingTitleElement.title = "Edit meeting title for TranscripTonic"
    meetingTitleElement.style.cssText = `text-decoration: underline white; text-underline-offset: 4px;`

    meetingTitleElement?.addEventListener("input", handleMeetingTitleElementChange)

    // Pick up meeting name after a delay, since Google meet updates meeting name after a delay
    setTimeout(() => {
      handleMeetingTitleElementChange()
      if (location.pathname === `/${meetingTitleElement.innerText}`) {
        showNotification({ status: 200, message: "<b>Give this meeting a title?</b><br/>Edit the underlined text in the bottom left corner" })
      }
    }, 7000)

    function handleMeetingTitleElementChange() {
      meetingTitle = meetingTitleElement.innerText
      overWriteChromeStorage(["meetingTitle"], false)
    }
  })
}

/**
 * @description Returns all elements of the specified selector type and specified textContent. Return array contains the actual element as well as all the parents.
 * @param {string} selector
 * @param {string | RegExp} text
 */
function selectElements(selector, text) {
  var elements = document.querySelectorAll(selector)
  return Array.prototype.filter.call(elements, function (element) {
    return RegExp(text).test(element.textContent)
  })
}

/**
 * @description Efficiently waits until the element of the specified selector and textContent appears in the DOM. Polls only on animation frame change
 * @param {string} selector
 * @param {string | RegExp} [text]
 */
async function waitForElement(selector, text) {
  if (text) {
    // loops for every animation frame change, until the required element is found
    while (!Array.from(document.querySelectorAll(selector)).find(element => element.textContent === text)) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  }
  else {
    // loops for every animation frame change, until the required element is found
    while (!document.querySelector(selector)) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  }
  return document.querySelector(selector)
}

/**
 * @param {{ selector: string, text: string }} captionsIconData
 */
async function waitForCaptionsButton(captionsIconData) {
  while (!getCaptionsButton(captionsIconData)) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

/**
 * @param {{ selector: string, text: string }} captionsIconData
 * @returns {HTMLElement | null}
 */
function getCaptionsButton(captionsIconData) {
  const semanticButton = document.querySelector(captionButtonSelector)
  if (semanticButton instanceof HTMLElement) {
    return semanticButton
  }

  const icon = selectElements(captionsIconData.selector, captionsIconData.text)[0]
  return icon instanceof HTMLElement ? icon : null
}

/**
 * @param {HTMLElement} captionsButton
 */
function areCaptionsEnabled(captionsButton) {
  const ariaLabel = captionsButton.getAttribute("aria-label") || ""
  const pressed = captionsButton.getAttribute("aria-pressed")
  if (pressed === "true") {
    return true
  }
  if (/off|enable|turn on|시작|켜기/i.test(ariaLabel)) {
    return false
  }
  if (/on|disable|turn off|끄기/i.test(ariaLabel)) {
    return true
  }
  return Boolean(getCaptionsContainer())
}

function getCaptionsContainer() {
  for (const selector of captionsContainerSelectors) {
    const element = document.querySelector(selector)
    if (element) {
      return element
    }
  }
  return null
}

/**
 * @description Waits for the live Google Meet captions region. Tries the current explicit captions region first and keeps older selectors as fallbacks.
 */
async function waitForCaptionsContainer() {
  while (true) {
    const element = getCaptionsContainer()
    if (element) {
      return element
    }
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

/**
 * @param {MutationObserver} transcriptObserver
 * @param {Element} initialTargetNode
 */
function watchCaptionsContainerReplacement(transcriptObserver, initialTargetNode) {
  let observedTargetNode = initialTargetNode
  const replacementObserver = new MutationObserver(() => {
    const latestTargetNode = getCaptionsContainer()
    if (latestTargetNode && latestTargetNode !== observedTargetNode) {
      observedTargetNode = latestTargetNode
      transcriptObserver.disconnect()
      transcriptObserver.observe(latestTargetNode, mutationConfig)
    }
  })

  replacementObserver.observe(document.body, { childList: true, subtree: true })
}

/**
 * @description Shows a responsive notification of specified type and message
 * @param {ExtensionStatusJSON} extensionStatusJSON
 */
function showNotification(extensionStatusJSON) {
  // Banner CSS
  let html = document.querySelector("html")
  let obj = document.createElement("div")
  let logo = document.createElement("img")
  let text = document.createElement("p")

  logo.setAttribute(
    "src",
    "https://ejnana.github.io/transcripto-status/icon.png"
  )
  logo.setAttribute("height", "32px")
  logo.setAttribute("width", "32px")
  logo.style.cssText = "border-radius: 4px"

  // Remove banner after 5s
  setTimeout(() => {
    obj.style.display = "none"
  }, 5000)

  if (extensionStatusJSON.status === 200) {
    obj.style.cssText = `color: #2A9ACA; ${commonCSS}`
    text.innerHTML = extensionStatusJSON.message

    // Add beta message
    if (extensionStatusJSON.showBetaMessage) {
      /** @type {ExtensionMessage} */
      const messageTeams = {
        type: "get_platform_status",
        platform: "teams"
      }
      /** @type {ExtensionMessage} */
      const messageZoom = {
        type: "get_platform_status",
        platform: "zoom"
      }

      chrome.runtime.sendMessage(messageTeams, (responseUntyped) => {
        const response = /** @type {ExtensionResponse} */ (responseUntyped)
        const isTeamsEnabled = (response.success) && (response.message === "Enabled")

        chrome.runtime.sendMessage(messageZoom, (responseUntyped) => {
          const response = /** @type {ExtensionResponse} */ (responseUntyped)
          const isZoomEnabled = (response.success) && (response.message === "Enabled")

          if (!isTeamsEnabled && !isZoomEnabled) {
            text.innerHTML += `<br/><br/> <b style="color:orange;">Teams and Zoom transcripts are in beta. <u>Click to open popup and enable.</u></b>`
            obj.style.cssText += `cursor: pointer;`

            text.addEventListener("click", () => {
              /** @type {ExtensionMessage} */
              const message = {
                type: "open_popup",
              }
              chrome.runtime.sendMessage(message, function (responseUntyped) {
                const response = /** @type {ExtensionResponse} */ (responseUntyped)
              })
            })
          }
        })


      })
    }
  }
  else {
    obj.style.cssText = `color: orange; ${commonCSS}`
    text.innerHTML = extensionStatusJSON.message
  }

  obj.prepend(text)
  obj.prepend(logo)
  if (html)
    html.append(obj)
}

// CSS for notification
const commonCSS = `background: rgb(255 255 255 / 100%); 
    backdrop-filter: blur(16px); 
    position: fixed;
    top: 5%; 
    left: 0; 
    right: 0; 
    margin-left: auto; 
    margin-right: auto;
    max-width: 780px;  
    z-index: 1000; 
    padding: 0rem 1rem;
    border-radius: 8px; 
    display: flex; 
    justify-content: center; 
    align-items: center; 
    gap: 16px;  
    font-size: 1rem; 
    line-height: 1.5; 
    font-family: "Google Sans",Roboto,Arial,sans-serif; 
    box-shadow: rgba(0, 0, 0, 0.16) 0px 10px 36px 0px, rgba(0, 0, 0, 0.06) 0px 0px 0px 1px;`


/**
 * @description Logs anonymous errors to a Google sheet for swift debugging
 * @param {string} code
 * @param {any} err
 */
function logError(code, err) {
  fetch(`https://script.google.com/macros/s/AKfycbwN-bVkVv3YX4qvrEVwG9oSup0eEd3R22kgKahsQ3bCTzlXfRuaiO7sUVzH9ONfhL4wbA/exec?version=${chrome.runtime.getManifest().version}&code=${code}&error=${encodeURIComponent(err)}&meetingSoftware=${meetingSoftware}`, { mode: "no-cors" })
}

/**
 * @description Checks if the installed extension version meets the minimum required version.
 * @param {string} oldVer
 * @param {string} newVer
 */
function meetsMinVersion(oldVer, newVer) {
  const oldParts = oldVer.split('.')
  const newParts = newVer.split('.')
  for (var i = 0; i < newParts.length; i++) {
    const a = ~~newParts[i] // parse int
    const b = ~~oldParts[i] // parse int
    if (a > b) return false
    if (a < b) return true
  }
  return true
}

/**
 * @description Fetches extension status from GitHub and saves to chrome storage. Defaults to 200, if remote server is unavailable.
 */
function checkExtensionStatus() {
  return new Promise((resolve, reject) => {
    // Set default value as 200
    extensionStatusJSON = { status: 200, message: "<strong>TranscripTonic is running</strong> <br /> Do not turn off captions" }

    // https://stackoverflow.com/a/42518434
    fetch(
      "https://ejnana.github.io/transcripto-status/status-prod-meet.json",
      { cache: "no-store" }
    )
      .then((response) => response.json())
      .then((result) => {
        const minVersion = result.minVersion

        // Disable extension if version is below the min version
        if (!meetsMinVersion(chrome.runtime.getManifest().version, minVersion)) {
          extensionStatusJSON.status = 400
          extensionStatusJSON.message = `<strong>TranscripTonic is not running</strong> <br /> Please update to v${minVersion} by following <a href="https://github.com/vivek-nexus/transcriptonic/wiki/Manually-update-TranscripTonic" target="_blank">these instructions</a>`
        }
        else {
          // Update status based on response
          extensionStatusJSON.status = result.status
          extensionStatusJSON.message = result.message
          extensionStatusJSON.showBetaMessage = (result.showBetaMessage === true)
        }

        console.log("Extension status fetched and saved")
        resolve("Extension status fetched and saved")
      })
      .catch((err) => {
        console.error(err)
        reject("Could not fetch extension status")

        logError("008", err)
      })
  })
}

/**
 * @description Attempts to recover last meeting to the best possible extent.
 */
function recoverLastMeeting() {
  return new Promise((resolve, reject) => {
    /** @type {ExtensionMessage} */
    const message = {
      type: "recover_last_meeting",
    }
    chrome.runtime.sendMessage(message, function (responseUntyped) {
      const response = /** @type {ExtensionResponse} */ (responseUntyped)
      if (response.success) {
        resolve("Last meeting recovered successfully or recovery not needed")
      }
      else {
        reject(response.message)
      }
    })
  })
}




// CURRENT GOOGLE MEET TRANSCRIPT DOM. TO BE UPDATED.

{/* <div class="a4cQT kV7vwc eO2Zfd" jscontroller="D1tHje" jsaction="bz0DVc:HWTqGc;E18dRb:lUFH9b;QBUr8:lUFH9b;stc2ve:oh3Xke" style="">
  // CAPTION LANGUAGE SETTINGS. MAY OR MAY NOT HAVE CHILDREN
  <div class="NmXUuc  P9KVBf" jscontroller="rRafu" jsaction="F41Sec:tsH52e;OmFrlf:xfAI6e(zHUIdd)"></div>
  <div class="DtJ7e">
    <span class="frX3lc-vlkzWd  P9KVBf"></span>
    <div jsname="dsyhDe" class="iOzk7 uYs2ee " style="">
      //PERSON 1
      <div class="nMcdL bj4p3b" style="">
        <div class="adE6rb M6cG9d">
          <img alt="" class="Z6byG r6DyN" src="https://lh3.googleusercontent.com/a/some-url" data-iml="63197.699999999255">
            <div class="KcIKyf jxFHg">Person 1</div>
        </div>
        <div jsname="YSxPC" class="bYevke wY1pdd" style="height: 27.5443px;">
          <div jsname="tgaKEf" class="bh44bd VbkSUe">
            Some transcript text.
            Some more text.</div>
        </div>
      </div>
      //PERSON 2
      <div class="nMcdL bj4p3b" style="">
        <div class="adE6rb M6cG9d">
          <img alt="" class="Z6byG r6DyN" src="https://lh3.googleusercontent.com/a/some-url" data-iml="63197.699999999255">
            <div class="KcIKyf jxFHg">Person 2</div>
        </div>
        <div jsname="YSxPC" class="bYevke wY1pdd" style="height: 27.5443px;">
          <div jsname="tgaKEf" class="bh44bd VbkSUe">
            Some transcript text.
            Some more text.</div>
        </div>
      </div>
    </div>
    <div jsname="APQunf" class="iOzk7 uYs2ee" style="display: none;">
    </div>
  </div>
  <div jscontroller="mdnBv" jsaction="stc2ve:MO88xb;QBUr8:KNou4c">
  </div>
</div> */}

// CURRENT GOOGLE MEET CHAT MESSAGES DOM
{/* <div jsname="xySENc" aria-live="polite" jscontroller="Mzzivb" jsaction="nulN2d:XL2g4b;vrPT5c:XL2g4b;k9UrDc:ClCcUe"
  class="Ge9Kpc z38b6">
  <div class="Ss4fHf" jsname="Ypafjf" tabindex="-1" jscontroller="LQRnv"
    jsaction="JIbuQc:sCzVOd(aUCive),T4Iwcd(g21v4c),yyLnsd(iJEnyb),yFT8A(RNMM1e),Cg1Rgf(EZbOH)" style="order: 0;">
    <div class="QTyiie">
      <div class="poVWob">You</div>
      <div jsname="biJjHb" class="MuzmKe">17:00</div>
    </div>
    <div class="beTDc">
      <div class="er6Kjc chmVPb">
        <div class="ptNLrf">
          <div jsname="dTKtvb">
            <div jscontroller="RrV5Ic" jsaction="rcuQ6b:XZyPzc" data-is-tv="false">Hello</div>
          </div>
          <div class="pZBsfc">Hover over a message to pin it<i class="google-material-icons VfPpkd-kBDsod WRc1Nb"
              aria-hidden="true">keep</i></div>
          <div class="MMfG3b"><span tooltip-id="ucc-17"></span><span data-is-tooltip-wrapper="true"><button
                class="VfPpkd-Bz112c-LgbsSe yHy1rc eT1oJ tWDL4c Brnbv pFZkBd" jscontroller="soHxf"
                jsaction="click:cOuCgd; mousedown:UX7yZ; mouseup:lbsD7e; mouseenter:tfO1Yc; mouseleave:JywGue; touchstart:p6p2H; touchmove:FwuNnf; touchend:yfqBxc; touchcancel:JMtRjd; focus:AHmuwe; blur:O22p3e; contextmenu:mg9Pef;mlnRJb:fLiPzd"
                jsname="iJEnyb" data-disable-idom="true" aria-label="Pin message" data-tooltip-enabled="true"
                data-tooltip-id="ucc-17" data-tooltip-x-position="3" data-tooltip-y-position="2" role="button"
                data-message-id="1714476309237">
                <div jsname="s3Eaab" class="VfPpkd-Bz112c-Jh9lGc"></div>
                <div class="VfPpkd-Bz112c-J1Ukfc-LhBDec"></div><i class="google-material-icons VfPpkd-kBDsod VjEpdd"
                  aria-hidden="true">keep</i>
              </button>
              <div class="EY8ABd-OWXEXe-TAWMXe" role="tooltip" aria-hidden="true" id="ucc-17">Pin message</div>
            </span></div>
        </div>
      </div>
    </div>
  </div>
</div> */}
