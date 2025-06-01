// public/main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 언어별 데이터 임포트
import { SCENARIO_DATA as ko_SCENARIO_DATA, UI_TEXT as ko_UI_TEXT } from './lang/ko.js';
import { SCENARIO_DATA as ja_SCENARIO_DATA, UI_TEXT as ja_UI_TEXT } from './lang/ja.js';

// 언어 팩 정의
const langPacks = {
    'ko': { scenarios: ko_SCENARIO_DATA, ui: ko_UI_TEXT, displayName: "한국어" },
    'ja': { scenarios: ja_SCENARIO_DATA, ui: ja_UI_TEXT, displayName: "日本語" },
};

// --- 앱 설정 (실제 사용 시 환경 변수 등으로 대체하는 것이 좋습니다) ---
const APP_ID = 'ai-tutor-html-default-v1';
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY", // 실제 API 키로 대체하세요
    authDomain: "YOUR_AUTH_DOMAIN", // 실제 Auth 도메인으로 대체하세요
    projectId: "YOUR_PROJECT_ID", // 실제 프로젝트 ID로 대체하세요
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID" // 실제 앱 ID로 대체하세요
};
const API_ENDPOINT = "https://magenta-morning-find.glitch.me/generate"; // AI 응답 생성 API 엔드포인트

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
    currentLangCode: '',
    SCENARIO_DATA: null,
    UI_TEXT: null,
    showLanguagePicker: false,
};

// --- DOM 요소 캐싱 (초기화 시 한 번만 수행하여 성능 최적화) ---
const elements = {};

function initDOMElements() {
    console.log("initDOMElements: DOM 요소 캐싱 시작"); // 디버깅 로그
    // 모든 요소를 찾을 때 null 여부를 확인하여, 존재하지 않으면 null로 할당합니다.
    // 이렇게 하면 이후 코드에서 null 체크만으로 안전하게 접근할 수 있습니다.
    elements.scenarioPickerButton = document.getElementById('scenarioPickerButton');
    elements.currentScenarioDisplay = document.getElementById('currentScenarioDisplay');
    elements.scenarioDropdown = document.getElementById('scenarioDropdown');
    elements.headerTitle = document.getElementById('headerTitle');
    elements.newConversationButton = document.getElementById('newConversationButton');
    elements.helpButton = document.getElementById('helpButton');

    // 언어 선택 관련 요소
    elements.languagePickerContainer = document.getElementById('languagePickerContainer');
    elements.languagePickerButton = document.getElementById('languagePickerButton');
    elements.currentLanguageDisplay = document.getElementById('currentLanguageDisplay');
    elements.languageDropdown = document.getElementById('languageDropdown');

    elements.scenarioDescriptionArea = document.getElementById('scenarioDescriptionArea');
    elements.scenarioTitleElem = document.getElementById('scenarioTitle');
    elements.scenarioDescriptionElem = document.getElementById('scenarioDescription');
    elements.starterPhrasesContainer = document.getElementById('starterPhrasesContainer');
    // elements.starterPhrasesElem은 동적으로 재생성되므로 여기서 캐시하지 않습니다.
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
    elements.roleSwapButtonText = document.getElementById('roleSwapButtonText');

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

    // 모달 내 UI 텍스트 요소들: 부모 요소가 존재해야 쿼리합니다.
    elements.guideModalTitle = elements.guideModal ? elements.guideModal.querySelector('h2') : null;
    elements.analysisModalTitle = elements.analysisModal ? elements.analysisModal.querySelector('h3') : null;
    elements.englishFeedbackTitle = elements.analysisModal ? elements.analysisModal.querySelector('#englishAnalysisResult h4') : null;
    elements.koreanSummaryTitle = elements.analysisModal ? elements.analysisModal.querySelector('#koreanAnalysisResult h4') : null;

    // 가이드 모달 내부 텍스트 요소들: `guideModalContent`가 존재해야 쿼리합니다.
    elements.guideP1 = elements.guideModalContent ? elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(1)') : null;
    elements.guideP2 = elements.guideModalContent ? elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(2)') : null;
    elements.guideP3 = elements.guideModalContent ? elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(3)') : null;
    elements.guideP4_header = elements.guideModalContent ? elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(4) strong') : null;
    elements.guideUl = elements.guideModalContent ? elements.guideModalContent.querySelector('ul') : null;
    // li 요소는 strong 태그를 포함하므로, innerHTML로 업데이트하기 위해 li 자체를 가져옵니다.
    elements.guideUl_item1_li = elements.guideUl ? elements.guideUl.querySelector('li:nth-of-type(1)') : null;
    elements.guideUl_item2_li = elements.guideUl ? elements.guideUl.querySelector('li:nth-of-type(2)') : null;
    elements.guideUl_item3_li = elements.guideUl ? elements.guideUl.querySelector('li:nth-of-type(3)') : null;
    elements.guideP5 = elements.guideModalContent ? elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(5)') : null;
    console.log("initDOMElements: DOM 요소 캐싱 완료", elements); // 디버깅 로그
}

// --- 유틸리티 함수 ---

/**
 * 간단한 마크다운을 HTML로 변환합니다.
 * @param {string} text - 변환할 텍스트
 * @returns {string} HTML 문자열
 */
function simpleMarkdownToHtml(text) {
    if (!text) return '';
    let html = text;
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
    // Italic: *text* or _text_
    html = html.replace(/\*(.*?)\*|_(.*?)_/g, '<em>$1$2</em>');
    // Strikethrough: ~~text~~
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');

    // Lists: - item, * item, + item (simplistic, assumes block starts with list)
    // First, convert list items to <li> tags
    html = html.replace(/^\s*[\*\-\+]\s+(.*)/gm, '<li>$1</li>');
    // Then wrap consecutive <li>s in <ul> tags
    html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

    // Newlines to <br /> (careful not to break list/block elements)
    html = html.replace(/\n/g, '<br />');

    // Clean up unwanted <br /> within lists or around block elements
    html = html.replace(/<li><br \/>/g, '<li>');
    html = html.replace(/<br \/><\/li>/g, '</li>');
    html = html.replace(/<br \/>\s*<ul>/g, '<ul>');
    html = html.replace(/<\/ul>\s*<br \/>/g, '</ul>');

    return html;
}

/**
 * ID로 시나리오 데이터를 찾습니다.
 * @param {string} id - 시나리오 ID
 * @returns {object|null} 해당 시나리오 객체 또는 null
 */
function findScenarioById(id) {
    for (const category of appState.SCENARIO_DATA) { // 현재 언어의 시나리오 데이터 사용
        const found = category.items.find(item => item.id === id);
        if (found) return { ...found, categoryTitle: category.category };
    }
    return null;
}

/**
 * 현재 역할에 맞는 시작 문구를 가져옵니다.
 * @param {object} scenario - 현재 시나리오 객체
 * @param {boolean} userIsPlayingPrimaryRole - 사용자가 주도적인 역할인지 여부
 * @returns {string[]} 시작 문구 배열
 */
function getStarterPhrases(scenario, userIsPlayingPrimaryRole) {
    return userIsPlayingPrimaryRole ? (scenario.starters_userAsPrimary || scenario.starters) : scenario.starters_userAsOther;
}

/**
 * AI 모델에 전달할 동적 컨텍스트를 생성합니다.
 * @param {object} scenario - 현재 시나리오 객체
 * @param {string} customInput - 사용자 정의 시나리오 입력
 * @param {string} focusTopic - 집중 연습 주제
 * @param {boolean} userIsPlayingPrimaryRole - 사용자가 주도적인 역할인지 여부
 * @returns {string} AI 컨텍스트 문자열
 */
function getDynamicContext(scenario, customInput, focusTopic, userIsPlayingPrimaryRole) {
    // AI의 역할 설명 및 대화 지침은 해당 언어로 제공되어야 함
    if (!scenario) return "あなたは一般的な日本語チューターです。シナリオは選択されていません。"; // 일본어

    let scenarioSpecificContext = "";
    if (scenario.id === "custom") {
        if (!customInput.trim()) return `あなたは親切で役立つAIチューターです。ユーザーはまだテーマを指定していません。何について話したいか尋ねてください。返信は簡潔に（1〜2文で）し、一度に1つの質問のみをしてください。`; // 日本語
        if (!userIsPlayingPrimaryRole) {
            scenarioSpecificContext = `ROLE SWAP: あなたはユーザーのカスタムシナリオ「${customInput}」に基づいて会話パートナーになりました。人間ユーザーはあなたのAIチューターまたはガイドとして行動します。シナリオに基づいて自然に返信し、返信は簡潔に（1〜2文で）し、必要に応じて一度に1つの質問のみをしてください。すでに回答を得た質問はしないでください。`; // 日本語
        } else {
            scenarioSpecificContext = `あなたは親切で役立つAIチューターです。ユーザーはカスタムシナリオ「${customInput}」に基づいて会話を練習したいと考えています。このテーマのパートナーとして行動し、関連する質問をし、ユーザーの日本語学習を手伝ってください。返信は簡潔に（1〜2文で）し、必要に応じて一度に1つの質問のみをしてください。すでに回答を得た質問はしないでください。`; // 日本語
        }
    } else {
        if (userIsPlayingPrimaryRole) {
            scenarioSpecificContext = scenario.baseContext; // SCENARIO_DATA.ja.js에서 일본어로 정의됨
        } else {
            scenarioSpecificContext = scenario.baseContext_swapped || `役割交代！あなたは今、「${scenario.title}」シナリオでAIが通常演じる役割を担っています。たとえば、ユーザーがカフェのお客さんだった場合、あなたは今お客さんです。人間ユーザーは相手の役割（例：バリスタ）を演じます。それに合わせて開始または返信し、返信は簡潔に（1〜2文で）し、必要に応じて一度に1つの質問のみをしてください。すでに回答を得た質問はしないでください。`; // 日本語
        }
    }

    const focusTopicInstruction = (userIsPlayingPrimaryRole && focusTopic && scenario.id !== "custom") ? `\n\nユーザーはさらに「${focusTopic}」に焦点を当てたいと考えています。会話にこれを取り入れてみてください。` : ''; // 日本語

    return `${scenarioSpecificContext}${focusTopicInstruction}`;
}

// --- UI 렌더링 및 조작 함수 ---

/**
 * 메시지 컨테이너에 현재 메시지들을 렌더링합니다.
 */
function renderMessages() {
    if (!elements.messagesContainer) return; // 요소 없으면 종료
    elements.messagesContainer.innerHTML = ''; // 기존 메시지 삭제
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
    // スクロールを最新メッセージに移動
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

/**
 * 시나리오 표시 영역을 업데이트합니다.
 * @param {boolean} isConversationStarting - 대화가 시작되었는지 여부 (설명 영역 숨김/표시용)
 */
function updateScenarioDisplay(isConversationStarting = false) {
    if (!appState.currentScenario) return;

    // 헤더 시나리오 이름 업데이트 (축약형)
    const displayTitle = appState.currentScenario.id === 'custom'
        ? (appState.currentCustomScenarioInput ? `${appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput).split(':')[0]}: ${appState.currentCustomScenarioInput.substring(0, 10)}...` : appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput))
        : (appState.currentScenario.categoryTitle ? `${appState.currentScenario.title.split(" ")[0]}` : appState.currentScenario.title.split(" ")[0]);

    if (elements.currentScenarioDisplay) elements.currentScenarioDisplay.textContent = displayTitle;
    if (elements.headerTitle) elements.headerTitle.title = appState.currentScenario.title; // 전체 제목은 툴팁으로

    // 대화 시작 여부에 따라 시나리오 설명 영역 숨김/표시
    const elementsToHide = document.querySelectorAll('.hide-after-conversation-start');
    if (isConversationStarting) {
        elementsToHide.forEach(el => el.classList.add('hidden'));
        if (elements.scenarioDescriptionArea) {
            elements.scenarioDescriptionArea.classList.remove('pb-4', 'sm:pb-5');
        }
        if (elements.scenarioTitleElem) {
            elements.scenarioTitleElem.classList.remove('mb-1.5');
            elements.scenarioTitleElem.classList.add('mb-0');
        }
    } else {
        elementsToHide.forEach(el => el.classList.remove('hidden'));
        if (elements.scenarioTitleElem) {
            elements.scenarioTitleElem.textContent = appState.currentScenario.id === "custom"
                ? appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)
                : appState.currentScenario.title;
        }
        if (elements.scenarioDescriptionElem) {
            elements.scenarioDescriptionElem.textContent = appState.currentScenario.id === "custom"
                ? appState.UI_TEXT.customScenarioDescription
                : appState.currentScenario.description;
        }

        // "이렇게 시작해 보세요:" 섹션의 모든 콘텐츠를 먼저 비웁니다. (누적 방지)
        if (elements.starterPhrasesContainer) {
            elements.starterPhrasesContainer.innerHTML = '';
        }


        const starters = getStarterPhrases(appState.currentScenario, appState.userIsPlayingPrimaryRole);
        if (starters && starters.length > 0) {
            if (elements.starterPhrasesContainer) {
                elements.starterPhrasesContainer.classList.remove('hidden');

                // "이렇게 시작해 보세요:" 텍스트를 위한 p 태그를 새로 생성하여 추가합니다.
                const starterPrefix = document.createElement('p');
                starterPrefix.className = "text-xs font-semibold text-sky-600 mb-1.5";
                starterPrefix.textContent = appState.UI_TEXT.starterPhrasePrefix;
                elements.starterPhrasesContainer.appendChild(starterPrefix);

                // 시작 문장 버튼들을 담을 div를 새로 생성하여 추가합니다.
                const newStarterPhrasesDiv = document.createElement('div');
                newStarterPhrasesDiv.id = 'starterPhrases'; // HTML에 정의된 ID와 동일하게 유지
                newStarterPhrasesDiv.className = 'flex flex-wrap gap-2';
                elements.starterPhrasesContainer.appendChild(newStarterPhrasesDiv);

                // 이제 새로 생성된 div에 버튼들을 추가합니다.
                starters.forEach(starter => {
                    const button = document.createElement('button');
                    button.className = "text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 px-2 py-1 rounded-md shadow-sm transition-colors";
                    button.textContent = `"${starter}"`;
                    // 동적으로 생성된 버튼에 직접 이벤트 리스너 연결
                    button.onclick = () => { if (elements.userInputElem) elements.userInputElem.value = starter; };
                    newStarterPhrasesDiv.appendChild(button); // 새로 생성된 div에 추가
                });
            }
        } else {
            if (elements.starterPhrasesContainer) {
                elements.starterPhrasesContainer.classList.add('hidden');
            }
        }

        // 사용자 설정 시나리오와 집중 연습 주제 입력 필드 표시/숨김 처리
        if (appState.currentScenario.id === "custom") {
            if (elements.customScenarioGroup) elements.customScenarioGroup.classList.remove('hidden');
            if (elements.focusTopicGroup) elements.focusTopicGroup.classList.add('hidden');
            if (elements.customScenarioInputElem) {
                elements.customScenarioInputElem.value = appState.currentCustomScenarioInput;
                elements.customScenarioInputElem.placeholder = appState.UI_TEXT.customScenarioPlaceholder;
            }
        } else {
            if (elements.customScenarioGroup) elements.customScenarioGroup.classList.add('hidden');
            if (elements.focusTopicGroup) elements.focusTopicGroup.classList.remove('hidden');
            if (elements.focusTopicInput) {
                elements.focusTopicInput.value = appState.currentFocusTopic;
                elements.focusTopicInput.placeholder = appState.UI_TEXT.focusTopicPlaceholder;
            }
        }

        // 시나리오 설명 영역의 하단 여백 및 제목 스타일 복구
        if (elements.scenarioDescriptionArea) {
            elements.scenarioDescriptionArea.classList.remove('hidden');
            elements.scenarioDescriptionArea.classList.add('pb-4', 'sm:pb-5');
        }
        if (elements.scenarioTitleElem) {
            elements.scenarioTitleElem.classList.add('mb-1.5');
            elements.scenarioTitleElem.classList.remove('mb-0');
        }
    }
}

/**
 * 앱의 모든 정적 버튼 및 UI 텍스트를 현재 언어에 맞춰 업데이트합니다.
 * 이 함수는 `lang/ko.js` 및 `lang/ja.js`의 UI_TEXT 객체에
 * HTML 문자열 형태의 상세 가이드 텍스트가 정의되어 있음을 가정합니다.
 */
function updateAllButtonTexts() {
    if (elements.headerTitle) elements.headerTitle.textContent = appState.UI_TEXT.appTitle;
    if (elements.helpButton) elements.helpButton.title = appState.UI_TEXT.guideModalTitle.split(' ')[0]; // 툴팁
    if (elements.newConversationButton) elements.newConversationButton.title = appState.UI_TEXT.newConversationAlert("").split(" ")[0]; // 툴팁

    if (elements.suggestRepliesButtonText) elements.suggestRepliesButtonText.textContent = appState.UI_TEXT.suggestReplies;
    if (elements.analyzeSentenceButtonText) elements.analyzeSentenceButtonText.textContent = appState.UI_TEXT.analyzeSentence;
    if (elements.roleSwapButtonText) elements.roleSwapButtonText.textContent = appState.UI_TEXT.roleSwapButtonText;
    if (elements.userInputElem) elements.userInputElem.placeholder = appState.UI_TEXT.customScenarioPlaceholder;

    // 가이드 모달 텍스트 업데이트 (UI_TEXT의 상세 HTML 텍스트 사용)
    if (elements.guideModalTitle) elements.guideModalTitle.textContent = appState.UI_TEXT.guideModalTitle;
    if (elements.guideP1) elements.guideP1.innerHTML = appState.UI_TEXT.guideP1_html;
    if (elements.guideP2) elements.guideP2.innerHTML = appState.UI_TEXT.guideP2_html;
    if (elements.guideP3) elements.guideP3.innerHTML = appState.UI_TEXT.guideP3_html;

    if (elements.guideP4_header) elements.guideP4_header.innerHTML = appState.UI_TEXT.guideP4_header_html;
    if (elements.guideUl_item1_li) elements.guideUl_item1_li.innerHTML = appState.UI_TEXT.guideP4_item1_html;
    if (elements.guideUl_item2_li) elements.guideUl_item2_li.innerHTML = appState.UI_TEXT.guideP4_item2_html;
    if (elements.guideUl_item3_li) elements.guideUl_item3_li.innerHTML = appState.UI_TEXT.guideP4_item3_html;

    if (elements.guideP5) elements.guideP5.innerHTML = appState.UI_TEXT.guideP5_html;
    if (elements.confirmGuideModalButton) elements.confirmGuideModalButton.textContent = appState.UI_TEXT.guideModalConfirmButton;

    // 분석 모달 텍스트 업데이트
    if (elements.analysisModalTitle) elements.analysisModalTitle.textContent = appState.UI_TEXT.analysisResultTitle;
    if (elements.englishFeedbackTitle) elements.englishFeedbackTitle.textContent = appState.UI_TEXT.englishFeedbackTitle;
    if (elements.koreanSummaryTitle) elements.koreanSummaryTitle.textContent = appState.UI_TEXT.koreanSummaryTitle;
    if (elements.confirmAnalysisModalButtonFromAnalysis) elements.confirmAnalysisModalButtonFromAnalysis.textContent = appState.UI_TEXT.analysisConfirmButton;

    // 언어 선택 드롭다운 텍스트 업데이트
    const langLinks = elements.languageDropdown ? elements.languageDropdown.querySelectorAll('a') : [];
    langLinks.forEach(link => {
        const langCode = link.dataset.lang;
        if (langPacks[langCode]) {
            link.textContent = langPacks[langCode].displayName;
        }
    });

    // 현재 언어 표시 업데이트
    if (elements.currentLanguageDisplay && langPacks[appState.currentLangCode]) {
        elements.currentLanguageDisplay.textContent = langPacks[appState.currentLangCode].displayName;
    }
}


/**
 * 버튼의 로딩 상태를 설정하고 텍스트를 업데이트합니다.
 * @param {string} buttonId - 버튼의 ID
 * @param {string} textWhileLoading - 로딩 중 표시할 텍스트
 * @param {boolean} isLoadingFlag - 로딩 중인지 여부
 */
function setLoadingState(buttonId, textWhileLoading, isLoadingFlag) {
    const button = elements[buttonId];
    const buttonTextSpan = elements[`${buttonId}Text`];
    if (button && buttonTextSpan) {
        button.disabled = isLoadingFlag;
        buttonTextSpan.textContent = isLoadingFlag ? textWhileLoading : (buttonId === 'suggestRepliesButton' ? appState.UI_TEXT.suggestReplies : appState.UI_TEXT.analyzeSentence);
    }
}

/**
 * 메시지 전송 버튼의 로딩 상태를 설정합니다.
 * @param {boolean} isLoadingFlag - 로딩 중인지 여부
 */
function setSendMessageLoadingState(isLoadingFlag) {
    if (!elements.sendMessageButton) return;
    elements.sendMessageButton.disabled = isLoadingFlag;
    if (isLoadingFlag) {
        elements.sendMessageButton.innerHTML = `<svg class="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle> <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path> </svg>`;
    } else {
        elements.sendMessageButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-6 h-6"> <path d="M3.5 2.75a.75.75 0 00-1.061.645l1.906 11.438a.75.75 0 001.412-.001L7.25 9.086l5.438-4.078a.75.75 0 00-.816-1.299L4.06 7.354 3.5 2.75zM2.75 16.5a.75.75 0 001.061.645l12.626-7.575a.75.75 0 000-1.29l-12.626-7.575A.75.75 0 002.75 1.5v15z" /> </svg>`;
    }
}

/**
 * 입력 필드의 내용을 지웁니다.
 * @param {string} elementId - 입력 필드의 ID (예: 'userInputElem', 'customScenarioInputElem')
 */
function clearInput(elementId) {
    if (elements[elementId]) {
        elements[elementId].value = '';
    }
}

/**
 * AI 응답 제안 목록을 숨기고 내용을 지웁니다.
 */
function hideSuggestedReplies() {
    if (elements.suggestedRepliesList) elements.suggestedRepliesList.innerHTML = '';
    if (elements.suggestedRepliesContainer) elements.suggestedRepliesContainer.classList.add('hidden');
}

/**
 * 시나리오 선택 드롭다운을 렌더링합니다.
 */
function renderScenarioPicker() {
    if (!elements.scenarioDropdown) return;
    elements.scenarioDropdown.innerHTML = ''; // 기존 드롭다운 내용 초기화
    appState.SCENARIO_DATA.forEach(category => { // 현재 언어의 시나리오 데이터 사용
        const categoryDiv = document.createElement('div');
        const categoryHeader = document.createElement('div');
        // 카테고리 헤더 스타일 및 이벤트 리스너 설정
        categoryHeader.className = `flex justify-between items-center p-1.5 sm:p-2 hover:bg-sky-100 cursor-pointer text-slate-800 font-medium text-xs sm:text-sm category-header`;
        // '사용자 설정' 카테고리가 현재 선택된 시나리오일 경우 특별 스타일 적용
        if (category.isCustomCategory && appState.currentScenario && appState.currentScenario.id === category.items[0].id) {
            categoryHeader.classList.add('scenario-picker-item-selected');
        }

        const categoryTitleSpan = document.createElement('span');
        categoryTitleSpan.textContent = category.category;
        categoryHeader.appendChild(categoryTitleSpan);

        // '사용자 설정' 카테고리에는 확장/축소 화살표 없음
        if (!category.isCustomCategory) {
            const chevron = document.createElement('span');
            const svgNS = "http://www.w3.org/2000/svg";
            const svgEl = document.createElementNS(svgNS, "svg");
            svgEl.setAttribute("viewBox", "0 0 20 20");
            svgEl.setAttribute("fill", "currentColor");
            svgEl.classList.add("w-5", "h-5", "transform", "transition-transform");
            if (appState.expandedCategories[category.category]) {
                svgEl.classList.add("rotate-90"); // 확장된 상태
            } else {
                svgEl.classList.remove("rotate-90"); // 축소된 상태
            }
            const pathEl = document.createElementNS(svgNS, "path");
            pathEl.setAttribute("fill-rule", "evenodd");
            pathEl.setAttribute("d", "M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z");
            pathEl.setAttribute("clip-rule", "evenodd");
            svgEl.appendChild(pathEl);
            chevron.appendChild(svgEl);
            categoryHeader.appendChild(chevron);
        }

        // 카테고리 헤더 클릭 이벤트 (카테고리 확장/축소 또는 '사용자 설정' 시나리오 선택)
        categoryHeader.onclick = (event) => {
            event.stopPropagation(); // 이벤트 버블링 방지
            if (category.isCustomCategory) {
                handleScenarioSelect(category.items[0]);
            } else {
                appState.expandedCategories[category.category] = !appState.expandedCategories[category.category];
                renderScenarioPicker(); // 변경된 확장 상태로 드롭다운 재렌더링
            }
        };
        categoryDiv.appendChild(categoryHeader);

        // 카테고리가 확장되어 있고 '사용자 설정'이 아닐 경우 하위 시나리오 아이템 렌더링
        if (appState.expandedCategories[category.category] && !category.isCustomCategory) {
            const itemsDiv = document.createElement('div');
            itemsDiv.className = "pl-3 border-l border-sky-200";
            category.items.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = `py-1 px-1.5 sm:py-1.5 sm:px-2 text-xs hover:bg-sky-50 cursor-pointer text-slate-600 scenario-picker-item`;
                if (appState.currentScenario && appState.currentScenario.id === item.id) {
                    itemDiv.classList.add('scenario-picker-item-selected'); // 現在選択されているアイテムのスタイルを適用
                }
                itemDiv.textContent = item.title;
                // シナリオアイテムクリックイベント
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

/**
 * 시나리오 선택 드롭다운을 토글합니다.
 */
function toggleScenarioPicker() {
    appState.showScenarioPicker = !appState.showScenarioPicker;
    if (appState.showScenarioPicker) {
        renderScenarioPicker(); // ドロップダウン内容をレンダリング
        if (elements.scenarioDropdown) {
            elements.scenarioDropdown.classList.remove('hidden');
            elements.scenarioDropdown.classList.add('fade-in');
        }
        // シナリオピッカーが開いたら、言語ピッカーは閉じる
        if (appState.showLanguagePicker) {
            toggleLanguagePicker();
        }
    } else {
        if (elements.scenarioDropdown) {
            elements.scenarioDropdown.classList.add('hidden');
        }
        appState.expandedCategories = {}; // ドロップダウンを非表示にする際に拡張状態を初期化
    }
}

/**
 * 언어 선택 드롭다운을 토글합니다.
 */
function toggleLanguagePicker() {
    appState.showLanguagePicker = !appState.showLanguagePicker;
    if (appState.showLanguagePicker) {
        if (elements.languageDropdown) {
            elements.languageDropdown.classList.remove('hidden');
            elements.languageDropdown.classList.add('fade-in');
        }
        // 言語ピッカーが開いたら、シナリオピッカーは閉じる
        if (appState.showScenarioPicker) {
            toggleScenarioPicker();
        }
    } else {
        if (elements.languageDropdown) {
            elements.languageDropdown.classList.add('hidden');
        }
    }
}


// --- 모달 관련 함수 ---

/**
 * 사용 가이드 모달을 표시합니다.
 */
function showGuideModal() {
    if (!elements.guideModal) return;
    elements.guideModal.classList.remove('hidden');
    elements.guideModal.classList.add('fade-in');
}

/**
 * 사용 가이드 모달을 닫고, 다시 표시하지 않도록 로컬 스토리지에 저장합니다.
 */
function closeGuideModal() {
    if (!elements.guideModal) return;
    elements.guideModal.classList.add('hidden');
    localStorage.setItem(`guideShown_${APP_ID}`, 'true');
}

/**
 * 문장 분석 결과 모달을 표시합니다.
 * @param {string} combinedAnalysisText - 영어 분석 결과와 한국어 요약이 포함된 텍스트
 */
function showAnalysisModal(combinedAnalysisText) {
    const koreanSummaryMarker = appState.UI_TEXT.koreanSummaryTitle;
    const koreanSummaryIndex = combinedAnalysisText.indexOf(koreanSummaryMarker);

    let engAnalysis = "";
    let korSummary = "";

    if (koreanSummaryIndex !== -1) {
        engAnalysis = combinedAnalysisText.substring(0, koreanSummaryIndex).trim();
        korSummary = combinedAnalysisText.substring(koreanSummaryIndex + koreanSummaryMarker.length).trim();
    } else {
        engAnalysis = combinedAnalysisText.trim();
        korSummary = "한국어 요약을 생성할 수 없습니다."; // 기본 메시지 (번역 필요)
    }

    if (elements.englishAnalysisResultDiv) elements.englishAnalysisResultDiv.innerHTML = simpleMarkdownToHtml(engAnalysis);
    if (elements.koreanAnalysisResultDiv) elements.koreanAnalysisResultDiv.innerHTML = simpleMarkdownToHtml(korSummary);

    if (elements.analysisModal) {
        elements.analysisModal.classList.remove('hidden');
        elements.analysisModal.classList.add('fade-in');
    }
}

/**
 * 문장 분석 결과 모달을 닫고 내용을 초기화합니다.
 */
function closeAnalysisModal() {
    if (elements.analysisModal) elements.analysisModal.classList.add('hidden');
    if (elements.englishAnalysisResultDiv) elements.englishAnalysisResultDiv.innerHTML = '';
    if (elements.koreanAnalysisResultDiv) elements.koreanAnalysisResultDiv.innerHTML = '';
}

// --- Firebase 서비스 함수 ---

/**
 * Firebase를 초기화하고 익명 인증을 처리합니다.
 * @returns {Promise<void>} 인증 완료 시 resolve
 */
async function initFirebase() {
    try {
        const firebaseApp = initializeApp(FIREBASE_CONFIG);
        appState.auth = getAuth(firebaseApp);
        appState.db = getFirestore(firebaseApp);

        return new Promise((resolve, reject) => {
            onAuthStateChanged(appState.auth, async (user) => {
                if (user) {
                    appState.currentUserId = user.uid;
                    console.log("Firebase: User logged in:", user.uid); // 디버깅 로그
                    resolve();
                } else {
                    try {
                        if (typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
                            const userCredential = await signInWithCustomToken(appState.auth, window.__initial_auth_token);
                            appState.currentUserId = userCredential.user.uid;
                            console.log("Firebase: Custom token login successful:", userCredential.user.uid); // 디버깅 로그
                        } else {
                            const userCredential = await signInAnonymously(appState.auth);
                            appState.currentUserId = userCredential.user.uid;
                            console.log("Firebase: Anonymous login successful:", userCredential.user.uid); // 디버깅 로그
                        }
                        resolve();
                    } catch (error) {
                        console.error("Firebase 인증 실패 (signInAnonymously/CustomToken):", error); // 디버깅 로그
                        reject(error);
                    }
                }
            });
        });
    } catch (error) {
        console.error("Firebase 초기화 실패 (initializeApp):", error); // 디버깅 로그
        throw error;
    }
}

/**
 * 사용자 프로필 데이터를 Firestore에서 가져옵니다.
 * @param {string} userId - 사용자 ID
 * @param {string} appId - 앱 ID
 * @returns {object|null} 사용자 프로필 데이터 또는 null
 */
async function getUserProfile(userId, appId) {
    if (!appState.db) {
        console.error("Firestore가 초기화되지 않았습니다. getUserProfile 불가.");
        return null;
    }
    const userProfileRef = doc(appState.db, `artifacts/${appId}/users/${userId}/profile`, 'info');
    try {
        const docSnap = await getDoc(userProfileRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
        console.error("사용자 프로필 로드 오류:", error);
        throw error;
    }
}

/**
 * 사용자 프로필 데이터를 Firestore에 업데이트합니다.
 * @param {string} userId - 사용자 ID
 * @param {string} appId - 앱 ID
 * @param {string} lastScenarioId - 마지막 시나리오 ID
 * @param {boolean} lastRoleIsUserPrimary - 마지막 역할 (사용자가 주도적 역할인지)
 * @param {string} lastFocusTopic - 마지막 집중 연습 주제
 * @param {string} lastCustomScenarioDetails - 마지막 사용자 정의 시나리오 내용
 */
async function updateUserProfile(userId, appId, lastScenarioId, lastRoleIsUserPrimary, lastFocusTopic, lastCustomScenarioDetails) {
    if (!appState.db) {
        console.error("Firestore가 초기화되지 않았습니다. updateUserProfile 불가.");
        return;
    }
    const userProfileRef = doc(appState.db, `artifacts/${appId}/users/${userId}/profile`, 'info');
    const updateData = {
        lastLogin: serverTimestamp(), // サーバータイムスタンプ（最終ログイン時間）
        lastScenarioId: lastScenarioId,
        lastRoleIsUserPrimary: lastRoleIsUserPrimary,
    };

    // ユーザー定義シナリオの場合、関連情報を保存
    if (lastScenarioId === "custom" && lastCustomScenarioDetails) {
        updateData.lastCustomScenarioDetails = {
            title: appState.UI_TEXT.scenarioTitleCustom(lastCustomScenarioDetails), // UI_TEXTからタイトル生成関数を使用
            description: lastCustomScenarioDetails
        };
        // カスタムシナリオの場合、focusTopicは保存しない
        delete updateData.lastFocusTopic; // 존재할 경우 삭제
    } else if (lastScenarioId !== "custom") {
        // 通常シナリオの場合、集中テーマを保存
        updateData.lastFocusTopic = lastFocusTopic;
        // 通常シナリオの場合、customScenarioDetailsは保存しない
        delete updateData.lastCustomScenarioDetails; // 존재할 경우 삭제
    }

    try {
        await setDoc(userProfileRef, updateData, { merge: true }); // merge: trueで既存フィールドは保持し、指定されたフィールドのみ更新
    } catch (error) {
        console.error("ユーザープロファイルの更新エラー:", error);
        throw error;
    }
}

/**
 * メッセージをFirestoreに保存します。
 * @param {string} collectionPath - メッセージを保存するFirestoreコレクションパス
 * @param {object} messageData - 保存するメッセージデータ
 * @returns {Promise<DocumentReference>} 保存されたドキュメントへの参照
 */
async function saveMessage(collectionPath, messageData) {
    if (!appState.db || !appState.currentUserId) {
        console.error("Firebaseが初期化されていないか、ユーザーが認証されていません。メッセージ保存不可.");
        throw new Error("Firebase is not initialized or user is not authenticated.");
    }
    return addDoc(collection(appState.db, collectionPath), { ...messageData, timestamp: serverTimestamp() });
}

// --- 外部API通信関数 ---

/**
 * AI (Gemini) APIを呼び出し、応答を受け取ります。
 * @param {string} prompt - AIに渡すプロンプト
 * @returns {Promise<string>} AI応答テキスト
 */
async function callGeminiAPI(prompt) {
    const payload = { message: prompt };
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            let errorDetails = `サーバー応答: ${response.statusText || '不明なエラー'}`; // 日本語エラーメッセージ
            try {
                const errorData = await response.json();
                errorDetails = errorData.error || errorData.message || (typeof errorData === 'object' ? JSON.stringify(errorData) : String(errorData));
                if (!errorDetails || errorDetails === '{}' || errorDetails.trim() === "") {
                    errorDetails = `サーバー応答: ${response.statusText || 'エラー内容なし'}`; // 日本語エラーメッセージ
                }
            } catch (jsonError) {
                console.warn("APIエラー応答がJSONではないため、テキストとして読み込もうとします。", jsonError); // 日本語コンソールメッセージ
                try {
                    const errorText = await response.text();
                    errorDetails = errorText.trim() || `サーバー応答: ${response.statusText || 'エラー内容なし'}`; // 日本語エラーメッセージ
                } catch (textError) {
                    console.error("APIエラー応答をテキストとして読み込むのに失敗しました。", textError); // 日本語コンソールメッセージ
                    errorDetails = `サーバー応答: ${response.statusText || '不明なエラー'}、応答本文の読み込み失敗`; // 日本語エラーメッセージ
                }
            }
            const errorMsg = `APIリクエスト失敗 (${response.status}): ${errorDetails}`; // 日本語エラーメッセージ
            console.error("API Error Details:", errorDetails);
            throw new Error(errorMsg);
        }

        const result = await response.json();
        // 応答形式に応じて適切なテキストを抽出
        if (result.text) {
            return result.text;
        } else if (result.generated_text) {
            return result.generated_text;
        } else if (result.reply) {
            return result.reply;
        } else if (typeof result === 'string') {
            return result;
        } else if (result.candidates && result.candidates[0]?.content?.parts[0]?.text) {
            console.warn("Gemini API形式の応答を受け取りました。Glitchエンドポイントがこの形式をサポートしているか確認してください。"); // 日本語コンソールメッセージ
            return result.candidates[0].content?.parts[0]?.text || '';
        } else {
            console.error("API応答からテキストを抽出できませんでした、または予期しない構造です:", result); // 日本語コンソールメッセージ
            throw new Error('AIから有効なテキスト応答を受け取っていません。'); // 日本語エラーメッセージ
        }
    } catch (error) {
        console.error("API呼び出し中に例外が発生しました:", error); // 日本語コンソールメッセージ
        throw error;
    }
}

// --- イベントハンドラー関数 ---

/**
 * メッセージ送信ボタンクリック、またはEnterキー入力時に呼び出されます。
 */
async function handleSendMessage() {
    // 入力欄が空であるか、AIが応答中の場合は実行しない
    if (!elements.userInputElem || elements.userInputElem.value.trim() === '' || appState.isLoading) return;

    // ユーザー定義シナリオで内容が空かつ最初のメッセージの場合に警告
    if (appState.currentScenario.id === "custom" && elements.customScenarioInputElem && elements.customScenarioInputElem.value.trim() === '' && appState.currentMessages.length === 0) {
        alert(appState.UI_TEXT.customScenarioInputRequired);
        return;
    }

    // 新しいユーザーメッセージを作成し、状態に追加
    const newUserMessage = { sender: 'user', text: elements.userInputElem.value.trim(), timestamp: new Date() };
    appState.currentMessages.push(newUserMessage);
    renderMessages(); // メッセージを画面にレンダリング
    const currentInputForAPI = elements.userInputElem.value; // API呼び出しのために現在の入力値を保存
    clearInput('userInputElem'); // 入力欄をクリア

    appState.isLoading = true; // ローディング状態を有効化
    setSendMessageLoadingState(true); // 送信ボタンのローディングUIを表示

    hideSuggestedReplies(); // 応答提案を非表示
    closeAnalysisModal(); // 分析モーダルを閉じる
    updateScenarioDisplay(true); // 会話開始後、シナリオ説明領域を非表示

    // Firebaseにユーザーメッセージを保存
    if (appState.currentUserId) {
        try {
            // ユーザー定義シナリオの場合、固有の会話パスを生成
            const conversationPath = `artifacts/${APP_ID}/users/${appState.currentUserId}/conversations/${appState.currentScenario.id === "custom" ? `custom_${(elements.customScenarioInputElem.value || '').substring(0,10).replace(/\s/g, '_')}` : appState.currentScenario.id}/messages`;
            await saveMessage(conversationPath, newUserMessage);
        } catch (error) {
            console.error("ユーザーメッセージの保存エラー:", error);
        }
    }

    // AIコンテキストと会話履歴を構成
    const contextForAI = getDynamicContext(
        appState.currentScenario,
        appState.currentCustomScenarioInput,
        appState.currentFocusTopic,
        appState.userIsPlayingPrimaryRole
    );

    let conversationHistoryForAPI = "Previous conversation:\n"; // AIプロンプトに渡す履歴（英語で保持）
    // 最近3ターン（ユーザーメッセージ3個 + AIメッセージ3個）の会話履歴を含める
    appState.currentMessages.slice(Math.max(0, appState.currentMessages.length - 7), -1).forEach(msg => {
        conversationHistoryForAPI += `${msg.sender === 'user' ? 'User' : 'AI'}: ${msg.text}\n`;
    });

    // AIに送信する最終プロンプト（System Instruction, Previous conversation, User Input）
    const promptForAI = `System Instruction: ${contextForAI}\n\n${appState.currentMessages.length > 1 ? conversationHistoryForAPI : ''}User: ${currentInputForAPI}`;

    try {
        const aiResponseText = await callGeminiAPI(promptForAI); // AI APIを呼び出し
        const newAiMessage = { sender: 'ai', text: aiResponseText, timestamp: new Date() };
        appState.currentMessages.push(newAiMessage); // AI応答を状態に追加
        renderMessages(); // AI応答を画面にレンダリング

        // FirebaseにAIメッセージを保存
        if (appState.currentUserId) {
            const conversationPath = `artifacts/${APP_ID}/users/${appState.currentUserId}/conversations/${appState.currentScenario.id === "custom" ? `custom_${(elements.customScenarioInputElem.value || '').substring(0,10).replace(/\s/g, '_')}` : appState.currentScenario.id}/messages`;
            await saveMessage(conversationPath, newAiMessage);
        }
    } catch (error) {
        // APIエラーが発生した場合、エラーメッセージを表示
        appState.currentMessages.push({ sender: 'ai', text: `${appState.UI_TEXT.aiResponseError} ${error.message}`, timestamp: new Date() });
        renderMessages();
    } finally {
        appState.isLoading = false; // ローディング状態を無効化
        setSendMessageLoadingState(false); // 送信ボタンのローディングUIを解除
    }
}

/**
 * AI応答提案ボタンクリック時に呼び出されます。
 */
async function handleSuggestReplies() {
    // すでにローディング中であるか、メッセージがない場合は実行しない
    if (appState.isLoadingSuggestions || appState.currentMessages.length === 0) return;
    const lastMessage = appState.currentMessages[appState.currentMessages.length - 1];
    // 最後のメッセージがAIの応答でない場合は警告
    if (lastMessage.sender !== 'ai') {
        alert(appState.UI_TEXT.suggestionsAfterAiResponse);
        return;
    }

    appState.isLoadingSuggestions = true; // ローディング状態を有効化
    setLoadingState('suggestRepliesButton', appState.UI_TEXT.loading, true); // ボタンのローディングUIを表示
    closeAnalysisModal(); // 分析モーダルを閉じる

    try {
        const scenarioTitleForPrompt = appState.currentScenario.id === "custom" ? (appState.currentCustomScenarioInput || appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)) : appState.currentScenario.title;
        const focusTopicForPrompt = appState.currentScenario.id === "custom" ? "" : (appState.currentFocusTopic ? `ユーザーはさらに「${appState.currentFocusTopic}」に焦点を当てたいと考えています。` : '');

        // AI応答提案のためのプロンプトを構成（AIが応答する言語、すなわち日本語）
        const prompt = `AIチューターの最後のメッセージ「${lastMessage.text}」に基づき、ユーザー（日本語学習者）が次に言うことができる、多様で自然な響きの返信を3つだけ（短〜中程度の長さで）、「${scenarioTitleForPrompt}」シナリオで提供してください。${focusTopicForPrompt} 厳密に番号付きリスト形式で、各項目を数字とピリオドで始めてください（例：1. 提案1）。リストの前後に導入文や説明文を含めないでください。ユーザーの現在の役割を考慮してください：${appState.userIsPlayingPrimaryRole ? '彼らはシナリオの主要な登場人物です（例：客、患者）' : '彼らはAIチューター/スタッフの役割を演じています'}。`;
        const suggestionsText = await callGeminiAPI(prompt); // AI APIを呼び出し

        // AI応答から提案リストをパース
        let parsedSuggestions = suggestionsText.split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0 && /^\d+\.\s*.+/.test(s))
            .map(s => s.replace(/^\d+\.\s*/, '').trim())
            .filter(s => s.length > 0 && !s.toLowerCase().startsWith("here are") && !s.toLowerCase().includes("suggestion for")); // 不要なフレーズをフィルタリング

        if (elements.suggestedRepliesList) elements.suggestedRepliesList.innerHTML = ''; // 既存の提案リストを初期化
        if (parsedSuggestions.length > 0) {
            parsedSuggestions.slice(0,3).forEach(reply => {
                const li = document.createElement('li');
                li.className = "text-xs sm:text-sm text-sky-700 hover:text-sky-800 cursor-pointer p-1.5 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow";
                li.textContent = `"${reply}"`;
                // 提案クリック時に入力欄に適用し、提案リストを非表示にする
                li.onclick = () => {
                    if (elements.userInputElem) elements.userInputElem.value = reply;
                    hideSuggestedReplies();
                };
                if (elements.suggestedRepliesList) elements.suggestedRepliesList.appendChild(li);
            });
            if (elements.suggestedRepliesContainer) {
                elements.suggestedRepliesContainer.classList.remove('hidden');
                elements.suggestedRepliesContainer.classList.add('fade-in');
            }
        } else {
            if (elements.suggestedRepliesList) {
                elements.suggestedRepliesList.innerHTML = `<li class="text-slate-500">${appState.UI_TEXT.errorMessageSuggestions}</li>`;
            }
            if (elements.suggestedRepliesContainer) {
                elements.suggestedRepliesContainer.classList.remove('hidden');
            }
        }
    } catch (error) {
        if (elements.suggestedRepliesList) {
            elements.suggestedRepliesList.innerHTML = `<li class="text-red-500">${appState.UI_TEXT.errorMessageSuggestions} ${error.message}</li>`;
        }
        if (elements.suggestedRepliesContainer) {
            elements.suggestedRepliesContainer.classList.remove('hidden');
        }
    } finally {
        appState.isLoadingSuggestions = false; // ローディング状態を無効化
        setLoadingState('suggestRepliesButton', '', false); // ボタンのローディングUIを解除
    }
}

/**
 * 文章分析ボタンクリック時に呼び出されます。
 */
async function handleAnalyzeSentence() {
    // すでにローディング中であるか、ユーザーメッセージがない場合は実行しない
    if (appState.isLoadingAnalysis) return;
    const userMessages = appState.currentMessages.filter(msg => msg.sender === 'user');
    if (userMessages.length === 0) {
        alert(appState.UI_TEXT.noUserMessageForAnalysis);
        return;
    }

    appState.isLoadingAnalysis = true; // ローディング状態を有効化
    setLoadingState('analyzeSentenceButton', appState.UI_TEXT.loading, true); // ボタンのローディングUIを表示
    hideSuggestedReplies(); // 応答提案を非表示
    closeAnalysisModal(); // 既存の分析モーダルを閉じる

    try {
        const lastUserMessage = userMessages[userMessages.length - 1]; // 最新のユーザーメッセージ
        const scenarioTitleForPrompt = appState.currentScenario.id === "custom" ? (appState.currentCustomScenarioInput || appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)) : appState.currentScenario.title;
        const focusTopicForPrompt = appState.currentScenario.id === "custom" ? "" : (appState.currentFocusTopic ? `ユーザーはさらに「${appState.currentFocusTopic}」に焦点を当てたいと考えています。` : '');

        // 文章分析のためのプロンプトを構成（英語フィードバック、韓国語要約をリクエスト）
        // ユーザーが日本語を入力したので、AIは入力された日本語に対するフィードバックを英語で、要約を韓国語で提供する必要があります。
        const analysisPrompt = `The user (learning Japanese) said: "${lastUserMessage.text}" in the context of "${scenarioTitleForPrompt}" scenario. ${focusTopicForPrompt} Provide a structured analysis in English: **⭐ Overall Impression:** (Brief positive comment or general feel) **👍 Strengths:** (What was good about the sentence) **💡 Areas for Improvement:** **Grammar:** (Specific errors & corrections. If none, say "Grammar is good.") **Vocabulary:** (Word choice suggestions, better alternatives. If good, say "Vocabulary is appropriate.") **Naturalness/Fluency:** (Tips to sound more natural. If good, say "Sounds natural.") **✨ Suggested Revision (if any):** (Offer a revised version of the sentence if significant improvements can be made) Keep feedback constructive and easy for a Japanese learner. After the English analysis, provide a concise summary of the feedback in Korean, under a heading "${appState.UI_TEXT.koreanSummaryTitle}". This summary should highlight the main points of the feedback for a beginner to understand easily.`;
        const combinedAnalysisText = await callGeminiAPI(analysisPrompt); // AI APIを呼び出し
        showAnalysisModal(combinedAnalysisText); // 分析結果をモーダルに表示
    } catch (error) {
        if (elements.englishAnalysisResultDiv) elements.englishAnalysisResultDiv.textContent = `${appState.UI_TEXT.errorMessageAnalysis} ${error.message}`;
        if (elements.koreanAnalysisResultDiv) elements.koreanAnalysisResultDiv.textContent = "";
        if (elements.analysisModal) {
            elements.analysisModal.classList.remove('hidden');
            elements.analysisModal.classList.add('fade-in');
        }
    } finally {
        appState.isLoadingAnalysis = false; // ローディング状態を無効化
        setLoadingState('analyzeSentenceButton', '', false); // ボタンのローディングUIを解除
    }
}

/**
 * 役割変更ボタンクリック時に呼び出されます。
 */
function handleRoleSwap() {
    if (appState.isLoading) {
        alert(appState.UI_TEXT.scenarioChangeLoadingAlert); // AI応答中は役割変更不可
        return;
    }
    appState.userIsPlayingPrimaryRole = !appState.userIsPlayingPrimaryRole; // 役割状態をトグル
    appState.currentMessages = []; // 会話履歴を初期化
    renderMessages(); // メッセージ画面を初期化
    clearInput('userInputElem'); // 入力欄をクリア
    hideSuggestedReplies(); // 応答提案を非表示
    closeAnalysisModal(); // 分析モーダルを閉じる
    updateScenarioDisplay(false); // シナリオ説明領域を更新（新しい役割に合わせて）

    // 役割変更通知メッセージを作成
    const currentRoleDescription = appState.userIsPlayingPrimaryRole ?
        (appState.currentScenario.id === "custom" ? '直接入力した状況の主要な役割' : `「${appState.currentScenario.title}」状況の主要な役割（例：お客さん、患者）`) :
        (appState.currentScenario.id === "custom" ? '直接入力した状況のAIの役割' : `「${appState.currentScenario.title}」状況のAIの役割（例：店員、医者）`);

    alert(appState.UI_TEXT.roleChangeAlert(currentRoleDescription));

    // 役割変更後、AIが最初に話すように促す（オプション）
    // if (!appState.userIsPlayingPrimaryRole && appState.currentMessages.length === 0 && appState.currentScenario.id !== 'custom') {
    //     const aiGreeting = getStarterPhrases(appState.currentScenario, false)[0] || "こんにちは！何かお手伝いできますか？";
    //     appState.currentMessages.push({ sender: 'ai', text: aiGreeting, timestamp: new Date() });
    //     renderMessages();
    // }
}

/**
 * 新しい会話開始ボタンクリック時に呼び出されます。
 */
function handleNewConversation() {
    if (appState.isLoading) {
        alert(appState.UI_TEXT.newConversationLoadingAlert); // AI応答中は新しい会話開始不可
        return;
    }
    appState.currentMessages = []; // 会話履歴を初期化
    renderMessages(); // メッセージ画面を初期化
    clearInput('userInputElem'); // 入力欄をクリア
    hideSuggestedReplies(); // 応答提案を非表示
    closeAnalysisModal(); // 分析モーダルを閉じる
    appState.userIsPlayingPrimaryRole = true; // 新しい会話開始時には主要な役割にリセット
    updateScenarioDisplay(false); // シナリオ説明領域を再表示

    // 新しい会話開始通知メッセージ
    const scenarioTitleForAlert = appState.currentScenario.id === 'custom' ? (appState.currentCustomScenarioInput || appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)) : appState.currentScenario.title;
    alert(appState.UI_TEXT.newConversationAlert(scenarioTitleForAlert));
}

/**
 * シナリオ選択ドロップダウンでシナリオアイテムがクリックされたときに呼び出されます。
 * @param {object} scenarioItem - 選択されたシナリオアイテムオブジェクト
 */
function handleScenarioSelect(scenarioItem) {
    if (appState.isLoading) {
        alert(appState.UI_TEXT.scenarioChangeLoadingAlert); // AI応答中はシナリオ変更不可
        return;
    }
    const fullScenarioDetails = findScenarioById(scenarioItem.id); // 現在の言語のシナリオデータから検索
    appState.currentScenario = fullScenarioDetails; // 現在のシナリオを更新
    appState.currentMessages = []; // 会話履歴を初期化
    clearInput('userInputElem'); // 入力欄をクリア
    hideSuggestedReplies(); // 応答提案を非表示
    closeAnalysisModal(); // 分析モーダルを閉じる
    appState.userIsPlayingPrimaryRole = true; // シナリオ変更時には主要な役割にリセット

    // シナリオの種類に応じて関連する入力フィールドの状態をリセット
    if (scenarioItem.id !== "custom") {
        appState.currentCustomScenarioInput = '';
        clearInput('customScenarioInputElem');
    } else {
        appState.currentFocusTopic = '';
        clearInput('focusTopicInput');
    }
    updateScenarioDisplay(false); // シナリオ説明領域を更新（新しいシナリオに合わせて）
    renderMessages(); // メッセージ画面を初期化
    toggleScenarioPicker(); // ドロップダウンを閉じる
}

/**
 * 言語を変更する関数です。
 * @param {string} langCode - 変更する言語コード（'ko', 'ja'など）
 */
function setLanguage(langCode) {
    if (!langPacks[langCode]) {
        console.error(`サポートされていない言語コード: ${langCode}`);
        return;
    }

    appState.currentLangCode = langCode;
    appState.SCENARIO_DATA = langPacks[langCode].scenarios; // シナリオデータを変更
    appState.UI_TEXT = langPacks[langCode].ui; // UIテキストを変更

    localStorage.setItem('speakup_ai_lang', langCode); // ローカルストレージに言語設定を保存

    // UIテキストを更新
    updateAllButtonTexts();
    // シナリオ関連のUIを更新（現在のシナリオを維持しつつ言語のみ変更）
    // 以前にロードされた currentScenario.id を使用して、新しい言語パックから該当シナリオを再検索します。
    appState.currentScenario = findScenarioById(appState.currentScenario?.id || "cafe"); // currentScenarioがnullの場合、「cafe」に置き換え
    if (!appState.currentScenario) { // もしロードされたシナリオがなければ、デフォルト値に設定
         appState.currentScenario = findScenarioById("cafe");
    }
    updateScenarioDisplay(false); // シナリオUIテキストを更新
    renderScenarioPicker(); // シナリオドロップダウンのテキストを更新
    if (elements.currentLanguageDisplay) { // null 체크 추가
        elements.currentLanguageDisplay.textContent = langPacks[langCode].displayName; // 言語選択ボタンのテキストを更新
    }
}

// --- すべてのイベントリスナー設定関数 ---

/**
 * すべてのDOM要素にイベントリスナーを接続します。
 */
function attachEventListeners() {
    console.log("attachEventListeners: イベントリスナー接続開始"); // 디버깅 로그

    // null 체크 후 이벤트 리스너 연결
    if (elements.scenarioPickerButton) elements.scenarioPickerButton.addEventListener('click', toggleScenarioPicker);
    if (elements.newConversationButton) elements.newConversationButton.addEventListener('click', handleNewConversation);
    if (elements.helpButton) elements.helpButton.addEventListener('click', showGuideModal);

    if (elements.closeGuideModalButton) elements.closeGuideModalButton.addEventListener('click', closeGuideModal);
    if (elements.confirmGuideModalButton) elements.confirmGuideModalButton.addEventListener('click', closeGuideModal);

    if (elements.sendMessageButton) elements.sendMessageButton.addEventListener('click', handleSendMessage);
    if (elements.userInputElem) elements.userInputElem.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !appState.isLoading) {
            handleSendMessage();
        }
    });
    if (elements.suggestRepliesButton) elements.suggestRepliesButton.addEventListener('click', handleSuggestReplies);
    if (elements.analyzeSentenceButton) elements.analyzeSentenceButton.addEventListener('click', handleAnalyzeSentence);
    if (elements.roleSwapButton) elements.roleSwapButton.addEventListener('click', handleRoleSwap);

    if (elements.closeAnalysisModalButtonFromAnalysis) elements.closeAnalysisModalButtonFromAnalysis.addEventListener('click', closeAnalysisModal);
    if (elements.confirmAnalysisModalButtonFromAnalysis) elements.confirmAnalysisModalButtonFromAnalysis.addEventListener('click', closeAnalysisModal);

    // 入力フィールド変更イベント（状態更新）
    if (elements.focusTopicInput) elements.focusTopicInput.addEventListener('change', (e) => { appState.currentFocusTopic = e.target.value; });
    if (elements.customScenarioInputElem) elements.customScenarioInputElem.addEventListener('change', (e) => {
        appState.currentCustomScenarioInput = e.target.value;
        updateScenarioDisplay(); // ユーザー定義シナリオ説明の更新のために呼び出し
    });

    // 言語選択ドロップダウンのトグル
    if (elements.languagePickerButton) elements.languagePickerButton.addEventListener('click', toggleLanguagePicker);
    // 言語選択リンクのクリック（イベント委任）
    if (elements.languageDropdown) {
        elements.languageDropdown.addEventListener('click', (event) => {
            event.preventDefault(); // デフォルトのリンク動作を防止
            const target = event.target.closest('a'); // クリックされた要素、または最も近い<a>タグを検索
            if (target && target.dataset.lang) {
                const langCode = target.dataset.lang;
                setLanguage(langCode);
                toggleLanguagePicker(); // ドロップダウンを閉じる
            }
        });
    }

    // ドキュメント全体のクリック時にドロップダウン/モーダルを閉じるロジック
    document.addEventListener('click', (event) => {
        // シナリオドロップダウンの外部クリック時に閉じる
        if (elements.scenarioPickerContainer && !elements.scenarioPickerContainer.contains(event.target) && appState.showScenarioPicker) {
            toggleScenarioPicker();
        }
        // 言語ドロップダウンの外部クリック時に閉じる
        if (elements.languagePickerContainer && !elements.languagePickerContainer.contains(event.target) && appState.showLanguagePicker) {
            toggleLanguagePicker();
        }
        // 分析モーダルの外部クリック時に閉じる
        if (elements.analysisModalContent && !elements.analysisModalContent.contains(event.target) &&
            elements.analysisModal && !elements.analysisModal.classList.contains('hidden')) {
            closeAnalysisModal();
        }
        // ガイドモーダルの外部クリック時に閉じる
        if (elements.guideModalContent && !elements.guideModalContent.contains(event.target) &&
            elements.guideModal && !elements.guideModal.classList.contains('hidden')) {
            closeGuideModal();
        }
    });
    console.log("attachEventListeners: イベントリスナー接続完了"); // ディバーギングログ
}

// --- アプリ初期化ロジック ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOMContentLoaded: アプリ初期化開始"); // ディバーギングログ
    initDOMElements(); // 1. DOM要素をキャッシュ
    attachEventListeners(); // 2. すべてのイベントリスナーを接続

    // 3. 言語設定をロードし、適用
    const savedLang = localStorage.getItem('speakup_ai_lang') || 'ko'; // デフォルトは韓国語
    setLanguage(savedLang); // この時点でappState.SCENARIO_DATAとUI_TEXTが設定される

    // Firebaseの初期化とユーザー認証は非同期で待機
    try {
        await initFirebase(); // 4. Firebaseの初期化とユーザー認証
    } catch (firebaseError) {
        console.error("アプリ初期化中にFirebaseエラー:", firebaseError); // ディバーギングログ
        // Firebase 오류 시에도 앱이 완전히 죽지 않고 동작하도록 처리 (선택 사항)
        // 예를 들어, Firebase 관련 기능을 비활성화하거나 사용자에게 알림을 표시
    }


    // 5. ユーザープロファイルのロードとアプリの状態初期化
    if (appState.currentUserId) {
        try {
            const userProfile = await getUserProfile(appState.currentUserId, APP_ID);
            let loadedScenarioData = findScenarioById("cafe"); // デフォルト値「カフェで」（現在ロードされている言語のSCENARIO_DATAを使用）

            if (userProfile) {
                const lastScenarioId = userProfile.lastScenarioId;
                const foundScenarioFromDB = findScenarioById(lastScenarioId); // 現在の言語のSCENARIO_DATAから検索

                if (foundScenarioFromDB) {
                    loadedScenarioData = foundScenarioFromDB;
                    if (foundScenarioFromDB.id === "custom" && userProfile.lastCustomScenarioDetails) {
                        appState.currentCustomScenarioInput = userProfile.lastCustomScenarioDetails.description || "";
                        loadedScenarioData = { ...loadedScenarioData, title: appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput) };
                    } else if (foundScenarioFromDB.id !== "custom") {
                        appState.currentFocusTopic = userProfile.lastFocusTopic || '';
                    }
                    appState.userIsPlayingPrimaryRole = userProfile.lastRoleIsUserPrimary !== undefined ? userProfile.lastRoleIsUserPrimary : true;
                }
            }
            appState.currentScenario = loadedScenarioData;

            // ユーザープロファイルを更新（最終ログイン時間、現在のシナリオなど）
            await updateUserProfile(
                appState.currentUserId,
                APP_ID,
                appState.currentScenario.id,
                appState.userIsPlayingPrimaryRole,
                appState.currentFocusTopic,
                appState.currentCustomScenarioInput
            );
        } catch (error) {
            console.error("ユーザープロファイルのロードまたは初期化エラー:", error); // ディバーギングログ
            appState.currentScenario = findScenarioById("cafe"); // エラー発生時はデフォルトシナリオに設定
        }
    } else {
        appState.currentScenario = findScenarioById("cafe"); // 認証失敗時はデフォルトシナリオに設定
    }

    // 6. 初期UIレンダリング（言語ロード後、シナリオロード後）
    updateScenarioDisplay(false); // 会話開始前なので説明領域を表示
    renderMessages(); // 空のメッセージコンテナをレンダリング

    // 7. ガイドモーダル表示の確認（ローカルストレージを使用）
    if (!localStorage.getItem(`guideShown_${APP_ID}`)) {
        showGuideModal();
    }
    console.log("DOMContentLoaded: アプリ初期化完了"); // ディバーギングログ
});
