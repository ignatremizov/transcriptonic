// @ts-check
/// <reference path="../types/chrome.d.ts" />
/// <reference path="../types/index.js" />

let isMeetingsTableExpanded = false
let selectedMeetingKey = ""

document.addEventListener("DOMContentLoaded", function () {
    const webhookUrlForm = document.querySelector("#webhook-url-form")
    const webhookUrlInput = document.querySelector("#webhook-url")
    const saveButton = document.querySelector("#save-webhook")
    const autoPostCheckbox = document.querySelector("#auto-post-webhook")
    const autoDownloadCheckbox = document.querySelector("#auto-download-file")
    const simpleWebhookBodyRadio = document.querySelector("#simple-webhook-body")
    const advancedWebhookBodyRadio = document.querySelector("#advanced-webhook-body")
    const recoverLastMeetingButton = document.querySelector("#recover-last-meeting")
    const showAllButton = document.querySelector("#show-all")

    // Initial load of transcripts
    loadMeetings()

    // Reload transcripts when page becomes visible
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            loadMeetings()
        }
    })

    chrome.storage.onChanged.addListener(() => {
        loadMeetings()
    })

    if (recoverLastMeetingButton instanceof HTMLButtonElement) {
        recoverLastMeetingButton.addEventListener("click", function () {
            /** @type {ExtensionMessage} */
            const message = {
                type: "recover_last_meeting",
            }
            chrome.runtime.sendMessage(message, function (responseUntyped) {
                const response = /** @type {ExtensionResponse} */ (responseUntyped)
                loadMeetings()
                scrollTo({ top: 0, behavior: "smooth" })
                if (response.success) {
                    if (response.message === "No recovery needed") {
                        alert("Nothing to recover—you're on top of the world!")
                    }
                    else {
                        alert("Last meeting recovered successfully!")
                    }
                }
                else {
                    const parsedError = /** @type {ErrorObject} */ (response.message)
                    if (parsedError.errorCode === "013") {
                        alert(parsedError.errorMessage)
                    }
                    else if (parsedError.errorCode === "014") {
                        alert("Nothing to recover—you're on top of the world!")
                    }
                    else {
                        alert("Could not recover last meeting!")
                        console.error(parsedError.errorMessage)
                    }
                }
            })
        })
    }

    if (saveButton instanceof HTMLButtonElement && webhookUrlForm instanceof HTMLFormElement && webhookUrlInput instanceof HTMLInputElement && autoPostCheckbox instanceof HTMLInputElement && simpleWebhookBodyRadio instanceof HTMLInputElement && advancedWebhookBodyRadio instanceof HTMLInputElement) {
        // Initially disable the save button
        saveButton.disabled = true

        // Load saved webhook URL, auto-post setting, and webhook body type
        chrome.storage.sync.get(["webhookUrl", "autoPostWebhookAfterMeeting", "autoDownloadFileAfterMeeting", "webhookBodyType"], function (resultSyncUntyped) {
            const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

            if (resultSync.webhookUrl) {
                webhookUrlInput.value = resultSync.webhookUrl
                saveButton.disabled = !webhookUrlInput.checkValidity()
            }

            // Set checkbox state
            autoPostCheckbox.checked = resultSync.autoPostWebhookAfterMeeting
            if (autoDownloadCheckbox instanceof HTMLInputElement) {
                autoDownloadCheckbox.checked = resultSync.autoDownloadFileAfterMeeting !== false
            }
            updateAutoDownloadCheckBox()

            // Set radio button state
            if (resultSync.webhookBodyType === "advanced") {
                advancedWebhookBodyRadio.checked = true
            } else {
                simpleWebhookBodyRadio.checked = true
            }
        })

        // Handle URL input changes
        webhookUrlInput.addEventListener("input", function () {
            saveButton.disabled = !webhookUrlInput.checkValidity()
        })

        // Save webhook URL, auto-post setting, and webhook body type
        webhookUrlForm.addEventListener("submit", function (e) {
            e.preventDefault()
            const webhookUrl = webhookUrlInput.value
            if (webhookUrl === "") {
                // Save webhook URL and settings
                chrome.storage.sync.set({
                    webhookUrl: webhookUrl
                }, function () {
                    alert("Webhook URL saved!")
                })
            }
            else if (webhookUrl && webhookUrlInput.checkValidity()) {
                // Request runtime permission for the webhook URL
                requestWebhookAndNotificationPermission(webhookUrl).then(() => {
                    // Save webhook URL and settings
                    chrome.storage.sync.set({
                        webhookUrl: webhookUrl
                    }, function () {
                        alert("Webhook URL saved!")
                    })
                }).catch((error) => {
                    alert("Fine! No webhooks for you!")
                    console.error("Webhook permission error:", error)
                })
            }
        })

        // Auto save auto-post setting
        autoPostCheckbox.addEventListener("change", function () {
            // Save webhook URL and settings
            chrome.storage.sync.set({
                autoPostWebhookAfterMeeting: autoPostCheckbox.checked,
            }, function () {
                updateAutoDownloadCheckBox()
            })
        })

        if (autoDownloadCheckbox instanceof HTMLInputElement) {
            autoDownloadCheckbox.addEventListener("change", function () {
                if (!autoDownloadCheckbox.checked) {
                    if (!confirm("Text file serves as a harmless backup, you sure you don't need it?")) {
                        autoDownloadCheckbox.checked = true
                        return
                    }
                }
                chrome.storage.sync.set({
                    autoDownloadFileAfterMeeting: autoDownloadCheckbox.checked,
                }, function () { })
            })
        }

        function updateAutoDownloadCheckBox() {
            if (autoDownloadCheckbox?.parentElement instanceof HTMLDivElement && autoPostCheckbox instanceof HTMLInputElement) {
                autoDownloadCheckbox.parentElement.style.display = autoPostCheckbox.checked ? "flex" : "none"
                if (!autoPostCheckbox.checked && autoDownloadCheckbox instanceof HTMLInputElement) {
                    autoDownloadCheckbox.checked = true
                    chrome.storage.sync.set({
                        autoDownloadFileAfterMeeting: true,
                    }, function () { })
                }
            }
        }

        // Auto save webhook body type
        simpleWebhookBodyRadio.addEventListener("change", function () {
            // Save webhook URL and settings
            chrome.storage.sync.set({ webhookBodyType: "simple" }, function () { })
        })

        // Auto save webhook body type
        advancedWebhookBodyRadio.addEventListener("change", function () {
            // Save webhook URL and settings
            chrome.storage.sync.set({ webhookBodyType: advancedWebhookBodyRadio.checked ? "advanced" : "simple" }, function () { })
        })
    }

    if (showAllButton instanceof HTMLButtonElement) {
        showAllButton.addEventListener("click", () => {
            const meetingsTableContainer = document.querySelector("#meetings-table-container")
            meetingsTableContainer?.classList.remove("fade-mask")
            showAllButton.setAttribute("style", "display:none;")
            isMeetingsTableExpanded = true
        })
    }
})


// Request runtime permission for webhook URL
/**
 * @param {string} url
 */
function requestWebhookAndNotificationPermission(url) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(url)
            const originPattern = `${urlObj.protocol}//${urlObj.hostname}/*`

            // Request both host and notifications permissions
            chrome.permissions.request({
                origins: [originPattern],
                permissions: ["notifications"]
            }).then((granted) => {
                if (granted) {
                    resolve("Permission granted")
                } else {
                    reject(new Error("Permission denied"))
                }
            }).catch((error) => {
                reject(error)
            })
        } catch (error) {
            reject(error)
        }
    })
}

// Load and display recent transcripts
function loadMeetings() {
    const meetingsTable = document.querySelector("#meetings-table")
    const meetingLogViewer = document.querySelector("#meeting-log-viewer")

    chrome.storage.local.get(["meetings", "meetingTabId", "meetingSoftware", "meetingTitle", "meetingStartTimestamp", "transcript", "activeTranscriptBlock", "chatMessages"], function (resultLocalUntyped) {
        const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
        const displayMeetings = getDisplayMeetings(resultLocal)

        // Clear existing content
        if (meetingsTable) {
            meetingsTable.innerHTML = ""

            if (displayMeetings.length > 0) {
                if (!selectedMeetingKey || !displayMeetings.some(item => item.key === selectedMeetingKey)) {
                    selectedMeetingKey = displayMeetings[0].key
                }
                // Loop through the array in reverse order to list latest meeting first
                displayMeetings.forEach((displayMeeting) => {
                    const meeting = displayMeeting.meeting
                    const i = displayMeeting.index
                    const timestamp = new Date(meeting.meetingStartTimestamp).toLocaleString()
                    const durationString = displayMeeting.isLive ? "Live now" : getDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp)
                    const meetingTitle = meeting.meetingTitle || meeting.title || "Google Meet call"

                    const row = document.createElement("tr")
                    row.dataset.meetingKey = displayMeeting.key
                    if (displayMeeting.key === selectedMeetingKey) {
                        row.classList.add("selected-meeting")
                    }
                    row.innerHTML = `
                    <td>
                        <div ${displayMeeting.isLive ? "" : `contenteditable="true"`} class="meeting-title" data-index="${i}" title="${displayMeeting.isLive ? "Current meeting" : "Rename"}">
                        ${escapeHTML(meetingTitle)}
                    </div>
                    </td>
                    <td>
                     ${meeting.meetingSoftware ? meeting.meetingSoftware : ""} 
                    </td>
                    <td>${timestamp} &nbsp; &#9679; &nbsp; ${durationString}</td>
                    <td>${getStatusMarkup(meeting, displayMeeting.isLive)}</td>
                    <td>
                        <div style="display: flex; gap: 1rem; justify-content: end">
                            <button class="download-button" data-index="${i}" title="Download" aria-label="Download this meeting transcript" ${displayMeeting.isLive ? "disabled" : ""}>
                                <img src="./icons/download.svg" alt="">
                            </button>
                            <button class="post-button" data-index="${i}" title="${meeting.webhookPostStatus === "new" ? `Post webhook` : `Repost webhook`}" aria-label="${meeting.webhookPostStatus === "new" ? `` : ``}" ${displayMeeting.isLive ? "disabled" : ""}>
                                ${meeting.webhookPostStatus === "new" ? `` : ``}
                                <img src="./icons/webhook.svg" alt="">
                            </button>
                            &nbsp;
                             <button class="delete-button" data-index="${i}" title="Delete" aria-label="Delete this meeting" ${displayMeeting.isLive ? "disabled" : ""}>
                                <img src="./icons/delete.svg" alt="">
                            </button>
                        </div>
                    </td>
                `
                    meetingsTable.appendChild(row)

                    row.addEventListener("click", function (event) {
                        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null)
                        if (target?.closest("button") || target?.closest(".meeting-title")) {
                            return
                        }
                        selectedMeetingKey = displayMeeting.key
                        loadMeetings()
                    })

                    // Add event listener to meeting title input
                    const meetingTitleInput = row.querySelector(".meeting-title")
                    if (!displayMeeting.isLive && meetingTitleInput instanceof HTMLDivElement) {
                        meetingTitleInput.addEventListener("blur", function () {
                            const updatedMeeting = /** @type {Meeting} */ {
                                ...meeting,
                                meetingTitle: meetingTitleInput.innerText
                            }
                            if (typeof i === "number" && resultLocal.meetings) {
                                resultLocal.meetings[i] = updatedMeeting
                            }
                            chrome.storage.local.set({ meetings: resultLocal.meetings || [] }, function () {
                                console.log("Meeting title updated")
                            })
                        })
                    }

                    // Add event listener to the webhook post button
                    const downloadButton = row.querySelector(".download-button")
                    if (!displayMeeting.isLive && downloadButton instanceof HTMLButtonElement) {
                        downloadButton.addEventListener("click", function () {
                            // Send message to background script to download text file
                            const index = parseInt(downloadButton.getAttribute("data-index") ?? "-1")
                            /** @type {ExtensionMessage} */
                            const message = {
                                type: "download_transcript_at_index",
                                index: index
                            }
                            chrome.runtime.sendMessage(message, (responseUntyped) => {
                                const response = /** @type {ExtensionResponse} */ (responseUntyped)
                                if (!response.success) {
                                    alert("Could not download transcript")
                                    const parsedError = /** @type {ErrorObject} */ (response.message)
                                    if (typeof parsedError === 'object') {
                                        console.error(parsedError.errorMessage)
                                    }
                                }
                            })
                        })
                    }

                    // Add event listener to the webhook post button
                    const webhookPostButton = row.querySelector(".post-button")
                    if (!displayMeeting.isLive && webhookPostButton instanceof HTMLButtonElement) {
                        webhookPostButton.addEventListener("click", function () {
                            chrome.storage.sync.get(["webhookUrl"], function (resultSyncUntyped) {
                                const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
                                if (resultSync.webhookUrl) {
                                    // Request runtime permission for the webhook URL. Needed for cases when user signs on a new browser—webhook URL and other sync variables are available, but runtime permissions will be missing.
                                    requestWebhookAndNotificationPermission(resultSync.webhookUrl).then(() => {
                                        // Disable button and update text
                                        webhookPostButton.disabled = true
                                        webhookPostButton.textContent = meeting.webhookPostStatus === "new" ? "Posting..." : "Reposting..."

                                        // Send message to background script to post webhook
                                        const index = parseInt(webhookPostButton.getAttribute("data-index") ?? "-1")
                                        /** @type {ExtensionMessage} */
                                        const message = {
                                            type: "post_webhook_at_index",
                                            index: index
                                        }
                                        chrome.runtime.sendMessage(message, (responseUntyped) => {
                                            const response = /** @type {ExtensionResponse} */ (responseUntyped)
                                            loadMeetings()
                                            if (response.success) {
                                                alert("Posted successfully!")
                                            }
                                            else {
                                                const parsedError = /** @type {ErrorObject} */ (response.message)
                                                if (typeof parsedError === 'object') {
                                                    console.error(parsedError.errorMessage)
                                                }
                                            }
                                        })
                                    }).catch((error) => {
                                        alert("Fine! No webhooks for you!")
                                        console.error("Webhook permission error:", error)
                                    })
                                }
                                else {
                                    alert("Please provide a webhook URL")
                                }
                            })
                        })
                    }

                    // Add event listener to the meeting delete button
                    const deleteButton = row.querySelector(".delete-button")
                    if (!displayMeeting.isLive && deleteButton instanceof HTMLButtonElement) {
                        deleteButton.addEventListener("click", function () {
                            if (confirm("Delete this meeting?")) {
                                if (typeof i === "number" && resultLocal.meetings) {
                                    resultLocal.meetings.splice(i, 1)
                                }
                                chrome.storage.local.set({ meetings: resultLocal.meetings || [] }, function () {
                                    console.log("Meeting title updated")
                                })
                            }
                        })
                    }
                })
                const meetingsTableContainer = document.querySelector("#meetings-table-container")
                if (!isMeetingsTableExpanded && meetingsTableContainer && (meetingsTableContainer.clientHeight > 280)) {
                    meetingsTableContainer?.classList.add("fade-mask")
                    document.querySelector("#show-all")?.setAttribute("style", "display: block")
                }

                const selectedMeeting = displayMeetings.find(item => item.key === selectedMeetingKey) || displayMeetings[0]
                renderMeetingLog(selectedMeeting)
            }
            else {
                selectedMeetingKey = ""
                meetingsTable.innerHTML = `<tr><td colspan="5">Your next meeting will show up here</td></tr>`
                if (meetingLogViewer instanceof HTMLDivElement) {
                    meetingLogViewer.hidden = true
                }
            }
        }
    })
}

/**
 * @param {ResultLocal} resultLocal
 * @returns {{ key: string, index: number | "live", isLive: boolean, meeting: Meeting }[]}
 */
function getDisplayMeetings(resultLocal) {
    const meetings = resultLocal.meetings || []
    const displayMeetings = []

    if (resultLocal.meetingTabId && resultLocal.meetingTabId !== "processing" && resultLocal.meetingStartTimestamp && ((resultLocal.transcript?.length || 0) > 0 || Boolean(resultLocal.activeTranscriptBlock?.transcriptText) || (resultLocal.chatMessages?.length || 0) > 0)) {
        displayMeetings.push({
            key: "live",
            index: "live",
            isLive: true,
            meeting: {
                meetingSoftware: resultLocal.meetingSoftware || "Google Meet",
                meetingTitle: resultLocal.meetingTitle || "Current meeting",
                meetingStartTimestamp: resultLocal.meetingStartTimestamp,
                meetingEndTimestamp: new Date().toISOString(),
                transcript: getTranscriptWithActiveBlock(resultLocal.transcript || [], resultLocal.activeTranscriptBlock),
                chatMessages: resultLocal.chatMessages || [],
                webhookPostStatus: "new"
            }
        })
    }

    for (let i = meetings.length - 1; i >= 0; i--) {
        displayMeetings.push({
            key: `saved-${i}`,
            index: i,
            isLive: false,
            meeting: meetings[i]
        })
    }

    return displayMeetings
}

/**
 * @param {TranscriptBlock[]} transcript
 * @param {TranscriptBlock | null | undefined} activeTranscriptBlock
 */
function getTranscriptWithActiveBlock(transcript, activeTranscriptBlock) {
    if (!activeTranscriptBlock || !activeTranscriptBlock.transcriptText) {
        return transcript
    }

    const lastBlock = transcript[transcript.length - 1]
    if (lastBlock &&
        lastBlock.personName === activeTranscriptBlock.personName &&
        lastBlock.timestamp === activeTranscriptBlock.timestamp &&
        lastBlock.transcriptText === activeTranscriptBlock.transcriptText) {
        return transcript
    }

    return [...transcript, activeTranscriptBlock]
}

/**
 * @param {Meeting} meeting
 * @param {boolean} isLive
 */
function getStatusMarkup(meeting, isLive) {
    if (isLive) {
        return `<span class="status-live">Live</span>`
    }

    switch (meeting.webhookPostStatus) {
        case "successful":
            return `<span class="status-success">Successful</span>`
        case "failed":
            return `<span class="status-failed">Failed</span>`
        case "new":
            return `<span class="status-new">New</span>`
        default:
            return `<span class="status-new">Unknown</span>`
    }
}

/**
 * @param {{ key: string, index: number | "live", isLive: boolean, meeting: Meeting }} displayMeeting
 */
function renderMeetingLog(displayMeeting) {
    const meetingLogViewer = document.querySelector("#meeting-log-viewer")
    const meetingLogTitle = document.querySelector("#meeting-log-title")
    const meetingLogMeta = document.querySelector("#meeting-log-meta")
    const meetingLogBody = document.querySelector("#meeting-log-body")

    if (!(meetingLogViewer instanceof HTMLDivElement) || !(meetingLogTitle instanceof HTMLHeadingElement) || !(meetingLogMeta instanceof HTMLParagraphElement) || !(meetingLogBody instanceof HTMLDivElement)) {
        return
    }

    const meeting = displayMeeting.meeting
    meetingLogViewer.hidden = false
    meetingLogTitle.textContent = meeting.meetingTitle || meeting.title || "Google Meet call"
    meetingLogMeta.textContent = `${meeting.meetingSoftware || "Meeting"} • ${new Date(meeting.meetingStartTimestamp).toLocaleString()} • ${displayMeeting.isLive ? "Live now" : getDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp)}`
    meetingLogBody.innerHTML = ""

    const transcript = meeting.transcript || []
    const chatMessages = meeting.chatMessages || []

    if (transcript.length === 0 && chatMessages.length === 0) {
        const empty = document.createElement("p")
        empty.className = "log-empty"
        empty.textContent = "No transcript or chat messages captured yet."
        meetingLogBody.appendChild(empty)
        return
    }

    if (transcript.length > 0) {
        meetingLogBody.appendChild(createLogGroup("Transcript", transcript.map(block => ({
            personName: block.personName,
            timestamp: block.timestamp,
            text: block.transcriptText
        }))))
    }

    if (chatMessages.length > 0) {
        meetingLogBody.appendChild(createLogGroup("Chat messages", chatMessages.map(block => ({
            personName: block.personName,
            timestamp: block.timestamp,
            text: block.chatMessageText
        }))))
    }
}

/**
 * @param {string} heading
 * @param {{ personName: string, timestamp: string, text: string }[]} entries
 */
function createLogGroup(heading, entries) {
    const group = document.createElement("div")
    group.className = "log-group"

    const headingElement = document.createElement("p")
    headingElement.className = "log-heading"
    headingElement.textContent = heading
    group.appendChild(headingElement)

    entries.forEach((entry) => {
        const entryElement = document.createElement("div")
        entryElement.className = "log-entry"

        const meta = document.createElement("div")
        meta.className = "log-entry-meta"

        const speaker = document.createElement("span")
        speaker.className = "log-entry-speaker"
        speaker.textContent = entry.personName || "Speaker"

        const timestamp = document.createElement("span")
        timestamp.textContent = ` • ${new Date(entry.timestamp).toLocaleString()}`

        const text = document.createElement("div")
        text.className = "log-entry-text"
        text.textContent = entry.text || ""

        meta.appendChild(speaker)
        meta.appendChild(timestamp)
        entryElement.appendChild(meta)
        entryElement.appendChild(text)
        group.appendChild(entryElement)
    })

    return group
}

/**
 * @param {string} value
 */
function escapeHTML(value) {
    const div = document.createElement("div")
    div.textContent = value
    return div.innerHTML
}

// Format duration between two timestamps, specified in milliseconds elapsed since the epoch
/**
 * @param {string} meetingStartTimestamp - ISO timestamp
 * @param {string} meetingEndTimestamp - ISO timestamp
 */
function getDuration(meetingStartTimestamp, meetingEndTimestamp) {
    const duration = new Date(meetingEndTimestamp).getTime() - new Date(meetingStartTimestamp).getTime()
    const durationMinutes = Math.round(duration / (1000 * 60))
    const durationHours = Math.floor(durationMinutes / 60)
    const remainingMinutes = durationMinutes % 60
    return durationHours > 0
        ? `${durationHours}h ${remainingMinutes}m`
        : `${durationMinutes}m`
}

// Add Firefox download support
if (typeof browser !== 'undefined' && /firefox/i.test(navigator.userAgent)) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'download_transcript_blob') {
            try {
                const blob = new Blob([message.blobContent], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = message.fileName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
                if (sendResponse) sendResponse({ success: true });
            } catch (e) {
                if (sendResponse) sendResponse({ success: false });
            }
            return true;
        }
    });
    // If meetings.html is opened by the background script, focus the window
    window.focus();
}
