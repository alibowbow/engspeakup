// public/main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 언어별 데이터 import
import { SCENARIO_DATA, UI_TEXT } from './lang/ko.js';

// --- 앱 설정 (하드코딩 또는 환경 변수 주입 필요) ---
const APP_ID = 'ai-tutor-html-default-v1';
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY", // 실제 API 키로 대체
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
const API_ENDPOINT = "https://magenta-morning-find.glitch.me/generate"; // Glitch API 엔드포인트

// --- 앱의 전역 상태 관리 ---
const appState = {
    currentMessages: [],
    currentScenario: null,
    currentFocusTopic: '',
    currentCustomScenarioInput: '',
    isLoading: false,
    isLoadingSuggestions: false,
    isLoadingAnalysis: false,
    showScenarioPicker: false,
    expandedCategories: {},
    currentUserId: null,
    userIsPlayingPrimaryRole: true,
    auth: null,
    db: null,
};

// --- DOM 요소 캐싱 (초기화 시 한 번만 수행) ---
const elements = {};

function initDOMElements() {
    elements.scenarioPickerButton = document.getElementById('scenarioPickerButton');
    elements.currentScenarioDisplay = document.getElementById('currentScenarioDisplay');
    elements.scenarioDropdown = document.getElementById('scenarioDropdown');
    elements.headerTitle = document.getElementById('headerTitle');
    elements.newConversationButton = document.getElementById('newConversationButton');
    elements.helpButton = document.getElementById('helpButton');

    elements.scenarioDescriptionArea = document.getElementById('scenarioDescriptionArea');
    elements.scenarioTitleElem = document.getElementById('scenarioTitle');
    elements.scenarioDescriptionElem = document.getElementById('scenarioDescription');
    elements.starterPhrasesContainer = document.getElementById('starterPhrasesContainer');
    elements.starterPhrasesElem = document.getElementById('starterPhrases');
    elements.focusTopicGroup = document.getElementById('focusTopicGroup');
    elements.focusTopicInput = document.getElementById('focusTopicInput');
    elements.customScenarioGroup = document.getElementById('customScenarioGroup');
    elements.customScenarioInputElem = document.getElementById('customScenarioInput');

    elements.messagesContainer = document.getElementById('messagesContainer');
    elements.userInputElem = document.getElementById('userInput');
    elements.sendMessageButton = document.getElementById('sendMessageButton');

    elements.suggestedRepliesContainer = document.getElementById('suggestedRepliesContainer');
    elements.suggestedRepliesList = document.getElementById('suggestedRepliesList');
    elements.suggestRepliesButton = document.getElementById('suggestRepliesButton');
    elements.suggestRepliesButtonText = document.getElementById('suggestRepliesButtonText');

    elements.analyzeSentenceButton = document.getElementById('analyzeSentenceButton');
    elements.analyzeSentenceButtonText = document.getElementById('analyzeSentenceButtonText');

    elements.roleSwapButton = document.getElementById('roleSwapButton');

    elements.guideModal = document.getElementById('guideModal');
    elements.guideModalContent = document.getElementById('guideModalContent');
    elements.closeGuideModalButton = document.getElementById('closeGuideModalButton');
    elements.confirmGuideModalButton = document.getElementById('confirmGuideModalButton');

    elements.analysisModal = document.getElementById('analysisModal');
    elements.analysisModalContent = document.getElementById('analysisModalContent');
    elements.englishAnalysisResultDiv = document.querySelector('#englishAnalysisResult div');
    elements.koreanAnalysisResultDiv = document.querySelector('#koreanAnalysisResult div');
    elements.closeAnalysisModalButtonFromAnalysis = document.getElementById('closeAnalysisModalButtonFromAnalysis');
    elements.confirmAnalysisModalButtonFromAnalysis = document.getElementById('confirmAnalysisModalButtonFromAnalysis');
}

// --- 유틸리티 함수 ---
function simpleMarkdownToHtml(text) {
    if (!text) return '';
    let html = text;
    html = html.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
    html = html.replace(/\*(.*?)\*|_(.*?)_/g, '<em>$1$2</em>');
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');
    html = html.replace(/^\s*[\*\-\+]\s+(.*)/gm, '<li>$1</li>');
    if (html.includes('<li>')) {
        const listItems = html.match(/<li>.*?<\/li>/g);
        if (listItems) {
            html = `<ul>${listItems.join('')}</ul>`;
        }
    }
    html = html.replace(/\n/g, '<br />');
    html = html.replace(/<li><br \/>/g, '<li>');
    html = html.replace(/<br \/><\/li>/g, '</li>');
    html = html.replace(/<br \/>\s*<ul>/g, '<ul>');
    html = html.replace(/<\/ul>\s*<br \/>/g, '</ul>');
    return html;
}

function findScenarioById(id) {
    for (const category of SCENARIO_DATA) {
        const found = category.items.find(item => item.id === id);
        if (found) return { ...found, categoryTitle: category.category };
    }
    return null;
}

function getStarterPhrases(scenario, userIsPlayingPrimaryRole) {
    return userIsPlayingPrimaryRole ? (scenario.starters_userAsPrimary || scenario.starters) : scenario.starters_userAsOther;
}

function getDynamicContext(scenario, customInput, focusTopic, userIsPlayingPrimaryRole) {
    if (!scenario) return "You are a general English language tutor. No scenario selected.";

    let scenarioSpecificContext = "";
    if (scenario.id === "custom") {
        if (!customInput.trim()) return "You are a general English language tutor. The user hasn't specified a topic yet. Ask what they'd like to talk about. Keep responses concise and ask one question at a time.";
        if (!userIsPlayingPrimaryRole) {
            scenarioSpecificContext = `ROLE SWAP: You are now the conversation partner based on the user's custom scenario: "${customInput}". The human user will act as your AI tutor or guide. Please respond naturally based on the scenario, keeping your responses concise (1-2 sentences) and asking only one question at a time if needed. Do not ask questions you've already received answers for.`;
        } else {
            scenarioSpecificContext = `You are a friendly and helpful English language tutor. The user wants to practice a conversation based on their custom scenario: "${customInput}". Act as a partner for this topic, ask relevant questions, and help with their English. Keep responses concise (1-2 sentences) and ask only one question at a time if needed. Do not ask questions you've already received answers for.`;
        }
    } else {
        if (userIsPlayingPrimaryRole) {
            scenarioSpecificContext = scenario.baseContext;
        } else {
            scenarioSpecificContext = scenario.baseContext_swapped || `ROLE SWAP! You are now taking on the role typically played by the AI in the "${scenario.title}" scenario. For example, if the user was the customer at a cafe, you are now the customer. The human user is playing the other part (e.g., barista). Please initiate or respond accordingly, keeping your responses concise (1-2 sentences) and asking only one question at a time if needed. Do not ask questions you've already received answers for.`;
        }
    }

    const focusTopicInstruction = (userIsPlayingPrimaryRole && focusTopic && scenario.id !== "custom") ? `\n\nThe user also wants to focus on: "${focusTopic}". Try to incorporate this into the conversation.` : '';

    return `${scenarioSpecificContext}${focusTopicInstruction}`;
}

// --- UI 렌더링 및 조작 함수 ---
function renderMessages() {
    elements.messagesContainer.innerHTML = '';
    appState.currentMessages.forEach(msg => {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`;
        const messageBubble = document.createElement('div');
        messageBubble.className = `max-w-3/4 sm:max-w-md lg:max-w-lg px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl shadow ${
            msg.sender === 'user' ? 'user-bubble text-white rounded-br-none' : 'ai-bubble text-slate-800 rounded-bl-none'
        }`;
        messageBubble.innerHTML = simpleMarkdownToHtml(msg.text);
        messageWrapper.appendChild(messageBubble);
        elements.messagesContainer.appendChild(messageWrapper);
    });
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function updateScenarioDisplay(isConversationStarting = false) {
    if (!appState.currentScenario) return;

    const displayTitle = appState.currentScenario.id === 'custom'
        ? (appState.currentCustomScenarioInput ? `${UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput).split(':')[0]}: ${appState.currentCustomScenarioInput.substring(0, 10)}...` : UI_TEXT.scenarioTitleCustom())
        : (appState.currentScenario.categoryTitle ? `${appState.currentScenario.title.split(" ")[0]}` : appState.currentScenario.title.split(" ")[0]);

    elements.currentScenarioDisplay.textContent = displayTitle;
    elements.headerTitle.title = appState.currentScenario.title;

    const elementsToHide = document.querySelectorAll('.hide-after-conversation-start');
    if (isConversationStarting) {
        elementsToHide.forEach(el => el.classList.add('hidden'));
        elements.scenarioDescriptionArea.classList.remove('pb-4', 'sm:pb-5');
        elements.scenarioTitleElem.classList.remove('mb-1.5');
        elements.scenarioTitleElem.classList.add('mb-0');
    } else {
        elementsToHide.forEach(el => el.classList.remove('hidden'));
        elements.scenarioTitleElem.textContent = appState.currentScenario.id === "custom"
            ? UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)
            : appState.currentScenario.title;
        elements.scenarioDescriptionElem.textContent = appState.currentScenario.id === "custom"
            ? UI_TEXT.customScenarioDescription
            : appState.currentScenario.description;

        elements.starterPhrasesElem.innerHTML = '';
        const starters = getStarterPhrases(appState.currentScenario, appState.userIsPlayingPrimaryRole);
        if (starters && starters.length > 0) {
            elements.starterPhrasesContainer.classList.remove('hidden');
            const starterPrefix = document.createElement('p');
            starterPrefix.className = "text-xs font-semibold text-sky-600 mb-1.5";
            starterPrefix.textContent = UI_TEXT.starterPhrasePrefix;
            elements.starterPhrasesContainer.prepend(starterPrefix); // 맨 위에 추가

            starters.forEach(starter => {
                const button = document.createElement('button');
                button.className = "text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 px-2 py-1 rounded-md shadow-sm transition-colors";
                button.textContent = `"${starter}"`;
                button.onclick = () => { elements.userInputElem.value = starter; };
                elements.starterPhrasesElem.appendChild(button);
            });
        } else {
            elements.starterPhrasesContainer.classList.add('hidden');
        }

        if (appState.currentScenario.id === "custom") {
            elements.customScenarioGroup.classList.remove('hidden');
            elements.focusTopicGroup.classList.add('hidden');
            elements.customScenarioInputElem.value = appState.currentCustomScenarioInput; // 사용자 설정 값 유지
        } else {
            elements.customScenarioGroup.classList.add('hidden');
            elements.focusTopicGroup.classList.remove('hidden');
            elements.focusTopicInput.value = appState.currentFocusTopic; // 집중 주제 값 유지
        }
        elements.scenarioDescriptionArea.classList.remove('hidden');
        elements.scenarioDescriptionArea.classList.add('pb-4', 'sm:pb-5');
        elements.scenarioTitleElem.classList.add('mb-1.5');
        elements.scenarioTitleElem.classList.remove('mb-0');
    }
}

function setLoadingState(buttonId, textWhileLoading, isLoadingFlag) {
    const button = elements[buttonId];
    const buttonTextSpan = elements[`${buttonId}Text`];
    if (button && buttonTextSpan) {
        button.disabled = isLoadingFlag;
        buttonTextSpan.textContent = isLoadingFlag ? UI_TEXT.loading : (buttonId === 'suggestRepliesButton' ? UI_TEXT.suggestReplies : UI_TEXT.analyzeSentence);
    }
}

function setSendMessageLoadingState(isLoadingFlag) {
    elements.sendMessageButton.disabled = isLoadingFlag;
    if (isLoadingFlag) {
        elements.sendMessageButton.innerHTML = `<svg class="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle> <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path> </svg>`;
    } else {
        elements.sendMessageButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-6 h-6"> <path d="M3.5 2.75a.75.75 0 00-1.061.645l1.906 11.438a.75.75 0 001.412-.001L7.25 9.086l5.438-4.078a.75.75 0 00-.816-1.299L4.06 7.354 3.5 2.75zM2.75 16.5a.75.75 0 001.061.645l12.626-7.575a.75.75 0 000-1.29l-12.626-7.575A.75.75 0 002.75 1.5v15z" /> </svg>`;
    }
}

function clearInput(elementId) {
    elements[elementId].value = '';
}

function hideSuggestedReplies() {
    elements.suggestedRepliesList.innerHTML = '';
    elements.suggestedRepliesContainer.classList.add('hidden');
}

function renderScenarioPicker() {
    elements.scenarioDropdown.innerHTML = '';
    SCENARIO_DATA.forEach(category => {
        const categoryDiv = document.createElement('div');
        const categoryHeader = document.createElement('div');
        categoryHeader.className = `flex justify-between items-center p-1.5 sm:p-2 hover:bg-sky-100 cursor-pointer text-slate-800 font-medium text-xs sm:text-sm category-header`;
        if (category.isCustomCategory && appState.currentScenario && appState.currentScenario.id === category.items[0].id) {
            categoryHeader.classList.add('scenario-picker-item-selected');
        }

        const categoryTitleSpan = document.createElement('span');
        categoryTitleSpan.textContent = category.category;
        categoryHeader.appendChild(categoryTitleSpan);

        if (!category.isCustomCategory) {
            const chevron = document.createElement('span');
            const svgNS = "http://www.w3.org/2000/svg";
            const svgEl = document.createElementNS(svgNS, "svg");
            svgEl.setAttribute("viewBox", "0 0 20 20");
            svgEl.setAttribute("fill", "currentColor");
            svgEl.classList.add("w-5", "h-5", "transform", "transition-transform");
            if (appState.expandedCategories[category.category]) {
                svgEl.classList.add("rotate-90");
            } else {
                svgEl.classList.remove("rotate-90");
            }
            const pathEl = document.createElementNS(svgNS, "path");
            pathEl.setAttribute("fill-rule", "evenodd");
            pathEl.setAttribute("d", "M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z");
            pathEl.setAttribute("clip-rule", "evenodd");
            svgEl.appendChild(pathEl);
            chevron.appendChild(svgEl);
            categoryHeader.appendChild(chevron);
        }

        categoryHeader.onclick = (event) => {
            event.stopPropagation();
            if (category.isCustomCategory) {
                handleScenarioSelect(category.items[0]);
            } else {
                appState.expandedCategories[category.category] = !appState.expandedCategories[category.category];
                renderScenarioPicker();
            }
        };
        categoryDiv.appendChild(categoryHeader);

        if (appState.expandedCategories[category.category] && !category.isCustomCategory) {
            const itemsDiv = document.createElement('div');
            itemsDiv.className = "pl-3 border-l border-sky-200";
            category.items.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = `py-1 px-1.5 sm:py-1.5 sm:px-2 text-xs hover:bg-sky-50 cursor-pointer text-slate-600 scenario-picker-item`;
                if (appState.currentScenario && appState.currentScenario.id === item.id) {
                    itemDiv.classList.add('scenario-picker-item-selected');
                }
                itemDiv.textContent = item.title;
                itemDiv.onclick = (event) => {
                    event.stopPropagation();
                    handleScenarioSelect(item);
                };
                itemsDiv.appendChild(itemDiv);
            });
            categoryDiv.appendChild(itemsDiv);
        }
        elements.scenarioDropdown.appendChild(categoryDiv);
    });
}

function toggleScenarioPicker() {
    appState.showScenarioPicker = !appState.showScenarioPicker;
    if (appState.showScenarioPicker) {
        renderScenarioPicker();
        elements.scenarioDropdown.classList.remove('hidden');
        elements.scenarioDropdown.classList.add('fade-in');
    } else {
        elements.scenarioDropdown.classList.add('hidden');
        appState.expandedCategories = {}; // 숨길 때 확장 상태 초기화
    }
}

// --- 모달 관련 함수 ---
function showGuideModal() {
    elements.guideModal.classList.remove('hidden');
    elements.guideModal.classList.add('fade-in');
}

function closeGuideModal() {
    elements.guideModal.classList.add('hidden');
    localStorage.setItem(`guideShown_${APP_ID}`, 'true');
}

function showAnalysisModal(combinedAnalysisText) {
    const koreanSummaryMarker = UI_TEXT.koreanSummaryTitle; // "🇰🇷 한국어 요약:"
    const koreanSummaryIndex = combinedAnalysisText.indexOf(koreanSummaryMarker);

    let engAnalysis = "";
    let korSummary = "";

    if (koreanSummaryIndex !== -1) {
        engAnalysis = combinedAnalysisText.substring(0, koreanSummaryIndex).trim();
        korSummary = combinedAnalysisText.substring(koreanSummaryIndex + koreanSummaryMarker.length).trim();
    } else {
        engAnalysis = combinedAnalysisText.trim();
        korSummary = "한국어 요약을 생성하지 못했습니다."; // 또는 다른 기본 메시지
    }

    elements.englishAnalysisResultDiv.innerHTML = simpleMarkdownToHtml(engAnalysis);
    elements.koreanAnalysisResultDiv.innerHTML = simpleMarkdownToHtml(korSummary);

    elements.analysisModal.classList.remove('hidden');
    elements.analysisModal.classList.add('fade-in');
}

function closeAnalysisModal() {
    elements.analysisModal.classList.add('hidden');
    elements.englishAnalysisResultDiv.innerHTML = '';
    elements.koreanAnalysisResultDiv.innerHTML = '';
}

// --- Firebase 서비스 함수 ---
async function initFirebase() {
    const firebaseApp = initializeApp(FIREBASE_CONFIG);
    appState.auth = getAuth(firebaseApp);
    appState.db = getFirestore(firebaseApp);

    return new Promise((resolve, reject) => {
        onAuthStateChanged(appState.auth, async (user) => {
            if (user) {
                appState.currentUserId = user.uid;
                resolve();
            } else {
                try {
                    if (typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
                        const userCredential = await signInWithCustomToken(appState.auth, window.__initial_auth_token);
                        appState.currentUserId = userCredential.user.uid;
                    } else {
                        const userCredential = await signInAnonymously(appState.auth);
                        appState.currentUserId = userCredential.user.uid;
                    }
                    resolve();
                } catch (error) {
                    console.error("Firebase 인증 실패:", error);
                    reject(error);
                }
            }
        });
    });
}

async function getUserProfile(userId, appId) {
    if (!appState.db) throw new Error("Firestore not initialized.");
    const userProfileRef = doc(appState.db, `artifacts/${appId}/users/${userId}/profile`, 'info');
    try {
        const docSnap = await getDoc(userProfileRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
        console.error("사용자 프로필 로드 오류:", error);
        throw error;
    }
}

async function updateUserProfile(userId, appId, lastScenarioId, lastRoleIsUserPrimary, lastFocusTopic, lastCustomScenarioDetails) {
    if (!appState.db) throw new Error("Firestore not initialized.");
    const userProfileRef = doc(appState.db, `artifacts/${appId}/users/${userId}/profile`, 'info');
    const updateData = {
        lastLogin: serverTimestamp(),
        lastScenarioId: lastScenarioId,
        lastRoleIsUserPrimary: lastRoleIsUserPrimary,
    };

    if (lastScenarioId === "custom" && lastCustomScenarioDetails) {
        updateData.lastCustomScenarioDetails = {
            title: UI_TEXT.scenarioTitleCustom(lastCustomScenarioDetails), // UI_TEXT에서 제목 생성 함수 사용
            description: lastCustomScenarioDetails
        };
    } else if (lastScenarioId !== "custom") {
        updateData.lastFocusTopic = lastFocusTopic;
    }

    try {
        await setDoc(userProfileRef, updateData, { merge: true });
    } catch (error) {
        console.error("사용자 프로필 업데이트 오류:", error);
        throw error;
    }
}

async function saveMessage(collectionPath, messageData) {
    if (!appState.db || !appState.currentUserId) {
        throw new Error("Firebase is not initialized or user is not authenticated.");
    }
    return addDoc(collection(appState.db, collectionPath), { ...messageData, timestamp: serverTimestamp() });
}

// --- API 통신 함수 ---
async function callGeminiAPI(prompt) {
    const payload = { message: prompt };
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            let errorDetails = `서버 응답: ${response.statusText || '알 수 없는 오류'}`;
            try {
                const errorData = await response.json();
                errorDetails = errorData.error || errorData.message || (typeof errorData === 'object' ? JSON.stringify(errorData) : String(errorData));
                if (!errorDetails || errorDetails === '{}' || errorDetails.trim() === "") {
                    errorDetails = `서버 응답: ${response.statusText || '오류 내용 없음'}`;
                }
            } catch (jsonError) {
                console.warn("API 오류 응답이 JSON이 아니므로 텍스트로 읽기를 시도합니다.", jsonError);
                try {
                    const errorText = await response.text();
                    errorDetails = errorText.trim() || `서버 응답: ${response.statusText || '오류 내용 없음'}`;
                } catch (textError) {
                    console.error("API 오류 응답을 텍스트로 읽는 데 실패했습니다.", textError);
                    errorDetails = `서버 응답: ${response.statusText || '알 수 없는 오류'}, 응답 본문 읽기 실패`;
                }
            }
            const errorMsg = `API 요청 실패 (${response.status}): ${errorDetails}`;
            console.error("API Error Details:", errorDetails);
            throw new Error(errorMsg);
        }

        const result = await response.json();
        if (result.text) {
            return result.text;
        } else if (result.generated_text) {
            return result.generated_text;
        } else if (result.reply) {
            return result.reply;
        } else if (typeof result === 'string') {
            return result;
        } else if (result.candidates && result.candidates[0]?.content?.parts[0]?.text) {
            console.warn("Gemini API 형식의 응답을 받았습니다. Glitch 엔드포인트가 이 형식을 지원하는지 확인하세요.");
            return result.candidates[0].content.parts[0].text;
        } else {
            console.error("API 응답에서 텍스트를 추출할 수 없거나, 예상치 못한 구조입니다:", result);
            throw new Error('AI로부터 유효한 텍스트 응답을 받지 못했습니다.');
        }
    } catch (error) {
        console.error("API 호출 중 예외 발생:", error);
        throw error;
    }
}

// --- 이벤트 핸들러 함수 ---
async function handleSendMessage() {
    if (elements.userInputElem.value.trim() === '' || appState.isLoading) return;
    if (appState.currentScenario.id === "custom" && elements.customScenarioInputElem.value.trim() === '' && appState.currentMessages.length === 0) {
        alert(UI_TEXT.customScenarioInputRequired);
        return;
    }

    const newUserMessage = { sender: 'user', text: elements.userInputElem.value.trim(), timestamp: new Date() };
    appState.currentMessages.push(newUserMessage);
    renderMessages();
    const currentInputForAPI = elements.userInputElem.value;
    clearInput('userInputElem');

    appState.isLoading = true;
    setSendMessageLoadingState(true);

    hideSuggestedReplies();
    closeAnalysisModal();
    updateScenarioDisplay(true); // 대화 시작 후 시나리오 설명 영역 숨기기

    if (appState.currentUserId) {
        try {
            const conversationPath = `artifacts/${APP_ID}/users/${appState.currentUserId}/conversations/${appState.currentScenario.id === "custom" ? `custom_${elements.customScenarioInputElem.value.substring(0,10).replace(/\s/g, '_')}` : appState.currentScenario.id}/messages`;
            await saveMessage(conversationPath, newUserMessage);
        } catch (error) {
            console.error("사용자 메시지 저장 오류:", error);
        }
    }

    const contextForAI = getDynamicContext(
        appState.currentScenario,
        appState.currentCustomScenarioInput,
        appState.currentFocusTopic,
        appState.userIsPlayingPrimaryRole
    );

    let conversationHistoryForAPI = "Previous conversation:\n";
    appState.currentMessages.slice(Math.max(0, appState.currentMessages.length - 7), -1).forEach(msg => {
        conversationHistoryForAPI += `${msg.sender === 'user' ? 'User' : 'AI'}: ${msg.text}\n`;
    });

    const promptForAI = `System Instruction: ${contextForAI}\n\n${appState.currentMessages.length > 1 ? conversationHistoryForAPI : ''}User: ${currentInputForAPI}`;

    try {
        const aiResponseText = await callGeminiAPI(promptForAI);
        const newAiMessage = { sender: 'ai', text: aiResponseText, timestamp: new Date() };
        appState.currentMessages.push(newAiMessage);
        renderMessages();

        if (appState.currentUserId) {
            const conversationPath = `artifacts/${APP_ID}/users/${appState.currentUserId}/conversations/${appState.currentScenario.id === "custom" ? `custom_${elements.customScenarioInputElem.value.substring(0,10).replace(/\s/g, '_')}` : appState.currentScenario.id}/messages`;
            await saveMessage(conversationPath, newAiMessage);
        }
    } catch (error) {
        appState.currentMessages.push({ sender: 'ai', text: `${UI_TEXT.aiResponseError} ${error.message}`, timestamp: new Date() });
        renderMessages();
    } finally {
        appState.isLoading = false;
        setSendMessageLoadingState(false);
    }
}

async function handleSuggestReplies() {
    if (appState.isLoadingSuggestions || appState.currentMessages.length === 0) return;
    const lastMessage = appState.currentMessages[appState.currentMessages.length - 1];
    if (lastMessage.sender !== 'ai') {
        alert(UI_TEXT.suggestionsAfterAiResponse);
        return;
    }

    appState.isLoadingSuggestions = true;
    setLoadingState('suggestRepliesButton', UI_TEXT.loading, true);
    closeAnalysisModal();

    try {
        const scenarioTitleForPrompt = appState.currentScenario.id === "custom" ? (appState.currentCustomScenarioInput || UI_TEXT.scenarioTitleCustom()) : appState.currentScenario.title;
        const focusTopicForPrompt = appState.currentScenario.id === "custom" ? "" : (appState.currentFocusTopic ? `The user also wants to focus on: "${appState.currentFocusTopic}".` : '');
        const prompt = `Based on the AI Tutor's last message: "${lastMessage.text}", provide ONLY 3 diverse and natural-sounding replies (short to medium length) that the user (who is learning English) could say next in the "${scenarioTitleForPrompt}" scenario. ${focusTopicForPrompt} Format them strictly as a numbered list, starting each item with a number and a period (e.g., 1. Suggestion one.). Do not include any introductory or explanatory text before or after the list. Consider the current role of the user: ${appState.userIsPlayingPrimaryRole ? 'they are the primary actor in the scenario (e.g., customer, patient)' : 'they are playing the AI tutor/staff role'}.`;
        const suggestionsText = await callGeminiAPI(prompt);

        let parsedSuggestions = suggestionsText.split('\n').map(s => s.trim()).filter(s => s.length > 0 && /^\d+\.\s*.+/.test(s)).map(s => s.replace(/^\d+\.\s*/, '').trim()).filter(s => s.length > 0 && !s.toLowerCase().startsWith("here are") && !s.toLowerCase().includes("suggestion for"));
        elements.suggestedRepliesList.innerHTML = '';
        if (parsedSuggestions.length > 0) {
            parsedSuggestions.slice(0,3).forEach(reply => {
                const li = document.createElement('li');
                li.className = "text-xs sm:text-sm text-sky-700 hover:text-sky-800 cursor-pointer p-1.5 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow";
                li.textContent = `"${reply}"`;
                li.onclick = () => {
                    elements.userInputElem.value = reply;
                    hideSuggestedReplies();
                };
                elements.suggestedRepliesList.appendChild(li);
            });
            elements.suggestedRepliesContainer.classList.remove('hidden');
            elements.suggestedRepliesContainer.classList.add('fade-in');
        } else {
            elements.suggestedRepliesList.innerHTML = `<li class="text-slate-500">${UI_TEXT.errorMessageSuggestions}</li>`;
            elements.suggestedRepliesContainer.classList.remove('hidden');
        }
    } catch (error) {
        elements.suggestedRepliesList.innerHTML = `<li class="text-red-500">${UI_TEXT.errorMessageSuggestions} ${error.message}</li>`;
        elements.suggestedRepliesContainer.classList.remove('hidden');
    } finally {
        appState.isLoadingSuggestions = false;
        setLoadingState('suggestRepliesButton', '', false);
    }
}

async function handleAnalyzeSentence() {
    if (appState.isLoadingAnalysis) return;
    const userMessages = appState.currentMessages.filter(msg => msg.sender === 'user');
    if (userMessages.length === 0) {
        alert(UI_TEXT.noUserMessageForAnalysis);
        return;
    }

    appState.isLoadingAnalysis = true;
    setLoadingState('analyzeSentenceButton', UI_TEXT.loading, true);
    hideSuggestedReplies();
    closeAnalysisModal();

    try {
        const lastUserMessage = userMessages[userMessages.length - 1];
        const scenarioTitleForPrompt = appState.currentScenario.id === "custom" ? (appState.currentCustomScenarioInput || UI_TEXT.scenarioTitleCustom()) : appState.currentScenario.title;
        const focusTopicForPrompt = appState.currentScenario.id === "custom" ? "" : (appState.currentFocusTopic ? `They are focusing on "${appState.currentFocusTopic}".` : '');
        const analysisPrompt = `The user (learning English) said: "${lastUserMessage.text}" in the context of "${scenarioTitleForPrompt}" scenario. ${focusTopicForPrompt} Provide a structured analysis in English: **⭐ Overall Impression:** (Brief positive comment or general feel) **👍 Strengths:** (What was good about the sentence) **💡 Areas for Improvement:** **Grammar:** (Specific errors & corrections. If none, say "Grammar is good.") **Vocabulary:** (Word choice suggestions, better alternatives. If good, say "Vocabulary is appropriate.") **Naturalness/Fluency:** (Tips to sound more natural. If good, say "Sounds natural.") **✨ Suggested Revision (if any):** (Offer a revised version of the sentence if significant improvements can be made) Keep feedback constructive and easy for an English learner. After the English analysis, provide a concise summary of the feedback in Korean, under a heading "${UI_TEXT.koreanSummaryTitle}". This summary should highlight the main points of the feedback for a beginner to understand easily.`;
        const combinedAnalysisText = await callGeminiAPI(analysisPrompt);
        showAnalysisModal(combinedAnalysisText);
    } catch (error) {
        elements.englishAnalysisResultDiv.textContent = `${UI_TEXT.errorMessageAnalysis} ${error.message}`;
        elements.koreanAnalysisResultDiv.textContent = "";
        elements.analysisModal.classList.remove('hidden');
        elements.analysisModal.classList.add('fade-in');
    } finally {
        appState.isLoadingAnalysis = false;
        setLoadingState('analyzeSentenceButton', '', false);
    }
}

function handleRoleSwap() {
    if (appState.isLoading) {
        alert(UI_TEXT.scenarioChangeLoadingAlert);
        return;
    }
    appState.userIsPlayingPrimaryRole = !appState.userIsPlayingPrimaryRole;
    appState.currentMessages = [];
    renderMessages();
    clearInput('userInputElem');
    hideSuggestedReplies();
    closeAnalysisModal();
    updateScenarioDisplay(false);

    const currentRoleDescription = appState.userIsPlayingPrimaryRole ?
        (appState.currentScenario.id === 'custom' ? '직접 입력한 상황의 주도적인 역할' : `"${appState.currentScenario.title}" 상황의 주도적인 역할 (예: 손님, 환자)`) :
        (appState.currentScenario.id === 'custom' ? '직접 입력한 상황의 AI 역할' : `"${appState.currentScenario.title}" 상황의 AI 역할 (예: 직원, 의사)`);

    alert(UI_TEXT.roleChangeAlert(currentRoleDescription));

    // 역할 변경 후 AI가 먼저 말하도록 유도하는 예시 (선택적)
    // if (!appState.userIsPlayingPrimaryRole && appState.currentMessages.length === 0 && appState.currentScenario.id !== 'custom') {
    //     const aiGreeting = getStarterPhrases(appState.currentScenario, false)[0] || "Hello! How can I assist you?";
    //     appState.currentMessages.push({ sender: 'ai', text: aiGreeting, timestamp: new Date() });
    //     renderMessages();
    // }
}

function handleNewConversation() {
    if (appState.isLoading) {
        alert(UI_TEXT.newConversationLoadingAlert);
        return;
    }
    appState.currentMessages = [];
    renderMessages();
    clearInput('userInputElem');
    hideSuggestedReplies();
    closeAnalysisModal();
    appState.userIsPlayingPrimaryRole = true;
    updateScenarioDisplay(false);

    const scenarioTitleForAlert = appState.currentScenario.id === 'custom' ? (appState.currentCustomScenarioInput || UI_TEXT.scenarioTitleCustom()) : appState.currentScenario.title;
    alert(UI_TEXT.newConversationAlert(scenarioTitleForAlert));
}

function handleScenarioSelect(scenarioItem) {
    if (appState.isLoading) {
        alert(UI_TEXT.scenarioChangeLoadingAlert);
        return;
    }
    const fullScenarioDetails = findScenarioById(scenarioItem.id);
    appState.currentScenario = fullScenarioDetails;
    appState.currentMessages = [];
    clearInput('userInputElem');
    hideSuggestedReplies();
    closeAnalysisModal();
    appState.userIsPlayingPrimaryRole = true;

    if (scenarioItem.id !== "custom") {
        appState.currentCustomScenarioInput = '';
        clearInput('customScenarioInputElem');
    } else {
        appState.currentFocusTopic = '';
        clearInput('focusTopicInput');
    }
    updateScenarioDisplay(false);
    renderMessages();
    toggleScenarioPicker(); // 드롭다운 닫기
}

// --- 이벤트 리스너 설정 ---
function attachEventListeners() {
    elements.scenarioPickerButton.addEventListener('click', toggleScenarioPicker);
    elements.newConversationButton.addEventListener('click', handleNewConversation);
    elements.helpButton.addEventListener('click', showGuideModal);

    elements.closeGuideModalButton.addEventListener('click', closeGuideModal);
    elements.confirmGuideModalButton.addEventListener('click', closeGuideModal);

    elements.sendMessageButton.addEventListener('click', handleSendMessage);
    elements.userInputElem.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !appState.isLoading) handleSendMessage(); });
    elements.suggestRepliesButton.addEventListener('click', handleSuggestReplies);
    elements.analyzeSentenceButton.addEventListener('click', handleAnalyzeSentence);
    elements.roleSwapButton.addEventListener('click', handleRoleSwap);

    elements.closeAnalysisModalButtonFromAnalysis.addEventListener('click', closeAnalysisModal);
    elements.confirmAnalysisModalButtonFromAnalysis.addEventListener('click', closeAnalysisModal);

    elements.focusTopicInput.addEventListener('change', (e) => { appState.currentFocusTopic = e.target.value; });
    elements.customScenarioInputElem.addEventListener('change', (e) => {
        appState.currentCustomScenarioInput = e.target.value;
        updateScenarioDisplay(); // 사용자 설정 시나리오 설명 업데이트를 위해 호출
    });

    document.addEventListener('click', (event) => {
        // 시나리오 드롭다운 외부 클릭 시 닫기
        if (elements.scenarioPickerButton && !elements.scenarioPickerButton.contains(event.target) &&
            elements.scenarioDropdown && !elements.scenarioDropdown.contains(event.target) && appState.showScenarioPicker) {
            toggleScenarioPicker();
        }
        // 모달 외부 클릭 시 닫기
        if (elements.analysisModalContent && !elements.analysisModalContent.contains(event.target) &&
            elements.analysisModal && !elements.analysisModal.classList.contains('hidden')) {
            closeAnalysisModal();
        }
        if (elements.guideModalContent && !elements.guideModalContent.contains(event.target) &&
            elements.guideModal && !elements.guideModal.classList.contains('hidden')) {
            closeGuideModal();
        }
    });
}

// --- 앱 초기화 ---
document.addEventListener('DOMContentLoaded', async () => {
    initDOMElements(); // DOM 요소 캐싱
    attachEventListeners(); // 모든 이벤트 리스너 연결

    await initFirebase(); // Firebase 초기화

    if (appState.currentUserId) {
        try {
            const userProfile = await getUserProfile(appState.currentUserId, APP_ID);
            let loadedScenarioData = findScenarioById("cafe"); // 기본값 '카페에서'

            if (userProfile) {
                const lastScenarioId = userProfile.lastScenarioId;
                const foundScenarioFromDB = findScenarioById(lastScenarioId);

                if (foundScenarioFromDB) {
                    loadedScenarioData = foundScenarioFromDB;
                    if (foundScenarioFromDB.id === "custom" && userProfile.lastCustomScenarioDetails) {
                        appState.currentCustomScenarioInput = userProfile.lastCustomScenarioDetails.description || "";
                        // UI 표시용 제목은 언어 데이터에 따라 생성
                        loadedScenarioData = { ...loadedScenarioData, title: UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput) };
                    } else if (foundScenarioFromDB.id !== "custom") {
                        appState.currentFocusTopic = userProfile.lastFocusTopic || '';
                    }
                    appState.userIsPlayingPrimaryRole = userProfile.lastRoleIsUserPrimary !== undefined ? userProfile.lastRoleIsUserPrimary : true;
                }
            }
            appState.currentScenario = loadedScenarioData;

            // 프로필 업데이트 (마지막 로그인 시간, 현재 시나리오 등)
            await updateUserProfile(
                appState.currentUserId,
                APP_ID,
                appState.currentScenario.id,
                appState.userIsPlayingPrimaryRole,
                appState.currentFocusTopic,
                appState.currentCustomScenarioInput
            );
        } catch (error) {
            console.error("사용자 프로필 로드 또는 초기화 오류:", error);
            appState.currentScenario = findScenarioById("cafe"); // 오류 시 기본값 설정
        }
    } else {
        appState.currentScenario = findScenarioById("cafe"); // 인증 실패 시 기본값 설정
    }

    // 초기 UI 렌더링
    updateScenarioDisplay(false);
    renderMessages();

    // 가이드 모달 표시 여부 확인 (LocalStorage 기반)
    if (!localStorage.getItem(`guideShown_${APP_ID}`)) {
        showGuideModal();
    }
});
