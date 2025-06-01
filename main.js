// public/main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 언어별 데이터 임포트
import { SCENARIO_DATA as ko_SCENARIO_DATA, UI_TEXT as ko_UI_TEXT } from './lang/ko.js';
import { SCENARIO_DATA as ja_SCENARIO_DATA, UI_TEXT as ja_UI_TEXT } from './lang/ja.js';

// 언어 팩 정의 (새로운 언어 추가 시 여기에 추가)
const langPacks = {
    'ko': { scenarios: ko_SCENARIO_DATA, ui: ko_UI_TEXT, displayName: "한국어" },
    'ja': { scenarios: ja_SCENARIO_DATA, ui: ja_UI_TEXT, displayName: "日本語" },
    // 'en': { scenarios: en_SCENARIO_DATA, ui: en_UI_TEXT, displayName: "English" }, // 예시
};

// --- 앱 설정 (하드코딩된 값은 실제 사용 시 환경 변수 등으로 대체하는 것이 좋습니다) ---
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
    currentScenario: null, // 현재 선택된 시나리오 객체
    currentFocusTopic: '', // 집중 연습 주제 (선택 사항)
    currentCustomScenarioInput: '', // 사용자 정의 시나리오 입력 내용
    isLoading: false, // AI 응답 대기 중 여부
    isLoadingSuggestions: false, // 응답 제안 대기 중 여부
    isLoadingAnalysis: false, // 문장 분석 대기 중 여부
    showScenarioPicker: false, // 시나리오 선택 드롭다운 표시 여부
    expandedCategories: {}, // 시나리오 드롭다운에서 카테고리 확장 상태
    currentUserId: null, // Firebase 사용자 ID
    userIsPlayingPrimaryRole: true, // 사용자가 시나리오의 주도적인 역할(예: 손님)을 맡고 있는지 여부
    auth: null, // Firebase Auth 인스턴스
    db: null, // Firestore DB 인스턴스
    currentLangCode: '', // 현재 활성화된 언어 코드 (ko, ja 등)
    SCENARIO_DATA: null, // 현재 언어의 시나리오 데이터
    UI_TEXT: null, // 현재 언어의 UI 텍스트
    showLanguagePicker: false, // 언어 선택 드롭다운 표시 여부
};

// --- DOM 요소 캐싱 (초기화 시 한 번만 수행하여 성능 최적화) ---
const elements = {};

function initDOMElements() {
    elements.scenarioPickerButton = document.getElementById('scenarioPickerButton');
    elements.currentScenarioDisplay = document.getElementById('currentScenarioDisplay');
    elements.scenarioDropdown = document.getElementById('scenarioDropdown');
    elements.headerTitle = document.getElementById('headerTitle');
    elements.newConversationButton = document.getElementById('newConversationButton');
    elements.helpButton = document.getElementById('helpButton');

    // 언어 선택 관련 요소 추가
    elements.languagePickerContainer = document.getElementById('languagePickerContainer');
    elements.languagePickerButton = document.getElementById('languagePickerButton');
    elements.currentLanguageDisplay = document.getElementById('currentLanguageDisplay');
    elements.languageDropdown = document.getElementById('languageDropdown');

    elements.scenarioDescriptionArea = document.getElementById('scenarioDescriptionArea');
    elements.scenarioTitleElem = document.getElementById('scenarioTitle');
    elements.scenarioDescriptionElem = document.getElementById('scenarioDescription');
    elements.starterPhrasesContainer = document.getElementById('starterPhrasesContainer');
    // elements.starterPhrasesElem = document.getElementById('starterPhrases'); // 동적으로 재생성되므로 여기서 캐시하지 않음
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
    elements.roleSwapButtonText = document.getElementById('roleSwapButtonText'); // 역할 변경 버튼 텍스트 요소 추가

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

    // 모달 내 UI 텍스트 요소 (querySelector를 통해 찾음)
    elements.guideModalTitle = elements.guideModal.querySelector('h2');
    elements.analysisModalTitle = elements.analysisModal.querySelector('h3');
    elements.englishFeedbackTitle = elements.analysisModal.querySelector('#englishAnalysisResult h4');
    elements.koreanSummaryTitle = elements.analysisModal.querySelector('#koreanAnalysisResult h4');

    // 가이드 모달 p태그들 (텍스트 업데이트를 위해 캐시)
    elements.guideP1 = elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(1)');
    elements.guideP2 = elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(2)');
    elements.guideP3 = elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(3)');
    elements.guideP4_header = elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(4) strong');
    elements.guideUl_item1_strong = elements.guideModalContent.querySelector('ul strong:nth-of-type(1)');
    elements.guideUl_item1_text = elements.guideModalContent.querySelector('ul strong:nth-of-type(1)').nextSibling;
    elements.guideUl_item2_strong = elements.guideModalContent.querySelector('ul strong:nth-of-type(2)');
    elements.guideUl_item2_text = elements.guideModalContent.querySelector('ul strong:nth-of-type(2)').nextSibling;
    elements.guideUl_item3_strong = elements.guideModalContent.querySelector('ul strong:nth-of-type(3)');
    elements.guideUl_item3_text = elements.guideModalContent.querySelector('ul strong:nth-of-type(3)').nextSibling;
    elements.guideP5 = elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(5)');
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
    // (예: 일본어 회화 앱이라면 이 부분이 일본어)
    if (!scenario) return "あなたは一般的な日本語チューターです。シナリオは選択されていません。"; // 일본어

    let scenarioSpecificContext = "";
    if (scenario.id === "custom") {
        if (!customInput.trim()) return `あなたは親切で役立つAIチューターです。ユーザーはまだテーマを指定していません。何について話したいか尋ねてください。返信は簡潔に（1〜2文で）し、一度に1つの質問のみをしてください。`; // 일본어
        if (!userIsPlayingPrimaryRole) {
            scenarioSpecificContext = `ROLE SWAP: あなたはユーザーのカスタムシナリオ「${customInput}」に基づいて会話パートナーになりました。人間ユーザーはあなたのAIチューターまたはガイドとして行動します。シナリオに基づいて自然に返信し、返信は簡潔に（1〜2文で）し、必要に応じて一度に1つの質問のみをしてください。すでに回答を得た質問はしないでください。`; // 일본어
        } else {
            scenarioSpecificContext = `あなたは親切で役立つAIチューターです。ユーザーはカスタムシナリオ「${customInput}」に基づいて会話を練習したいと考えています。このテーマのパートナーとして行動し、関連する質問をし、ユーザーの日本語学習を手伝ってください。返信は簡潔に（1〜2文で）し、必要に応じて一度に1つの質問のみをしてください。すでに回答を得た質問はしないでください。`; // 일본어
        }
    } else {
        // SCENARIO_DATA에 정의된 baseContext/baseContext_swapped는 AI가 응답할 언어(이 경우 일본어)로 되어 있어야 함
        if (userIsPlayingPrimaryRole) {
            scenarioSpecificContext = scenario.baseContext; // SCENARIO_DATA.ja.js에서 일본어로 정의됨
        } else {
            scenarioSpecificContext = scenario.baseContext_swapped || `役割交代！あなたは今、「${scenario.title}」シナリオでAIが通常演じる役割を担っています。たとえば、ユーザーがカフェのお客さんだった場合、あなたは今お客さんです。人間ユーザーは相手の役割（例：バリスタ）を演じます。それに合わせて開始または返信し、返信は簡潔に（1〜2文で）し、必要に応じて一度に1つの質問のみをしてください。すでに回答を得た質問はしないでください。`; // 일본어
        }
    }

    const focusTopicInstruction = (userIsPlayingPrimaryRole && focusTopic && scenario.id !== "custom") ? `\n\nユーザーはさらに「${focusTopic}」に焦点を当てたいと考えています。会話にこれを取り入れてみてください。` : ''; // 일본어

    return `${scenarioSpecificContext}${focusTopicInstruction}`;
}

// --- UI 렌더링 및 조작 함수 ---

/**
 * 메시지 컨테이너에 현재 메시지들을 렌더링합니다.
 */
function renderMessages() {
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
    // 스크롤을 최신 메시지로 이동
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

    elements.currentScenarioDisplay.textContent = displayTitle;
    elements.headerTitle.title = appState.currentScenario.title; // 전체 제목은 툴팁으로

    // 대화 시작 여부에 따라 시나리오 설명 영역 숨김/표시
    const elementsToHide = document.querySelectorAll('.hide-after-conversation-start');
    if (isConversationStarting) {
        elementsToHide.forEach(el => el.classList.add('hidden'));
        elements.scenarioDescriptionArea.classList.remove('pb-4', 'sm:pb-5');
        elements.scenarioTitleElem.classList.remove('mb-1.5');
        elements.scenarioTitleElem.classList.add('mb-0');
    } else {
        elementsToHide.forEach(el => el.classList.remove('hidden'));
        elements.scenarioTitleElem.textContent = appState.currentScenario.id === "custom"
            ? appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)
            : appState.currentScenario.title;
        elements.scenarioDescriptionElem.textContent = appState.currentScenario.id === "custom"
            ? appState.UI_TEXT.customScenarioDescription
            : appState.currentScenario.description;

        // "이렇게 시작해 보세요:" 섹션의 모든 콘텐츠를 먼저 비웁니다. (누적 방지)
        elements.starterPhrasesContainer.innerHTML = '';

        const starters = getStarterPhrases(appState.currentScenario, appState.userIsPlayingPrimaryRole);
        if (starters && starters.length > 0) {
            elements.starterPhrasesContainer.classList.remove('hidden');

            // "이렇게 시작해 보세요:" 텍스트를 위한 p 태그를 새로 생성하여 추가합니다.
            const starterPrefix = document.createElement('p');
            starterPrefix.className = "text-xs font-semibold text-sky-600 mb-1.5";
            starterPrefix.textContent = appState.UI_TEXT.starterPhrasePrefix;
            elements.starterPhrasesContainer.appendChild(starterPrefix);

            // 시작 문장 버튼들을 담을 div를 새로 생성하여 추가합니다.
            // HTML 구조에 따라 이 부분은 `starterPhrasesElem`이 캐시되어 있다면 해당 요소에 추가합니다.
            // 여기서는 `initDOMElements`에서 `elements.starterPhrasesElem`을 캐시하지 않으므로,
            // 새로운 div를 만들고 그 div를 `elements.starterPhrasesContainer`에 추가합니다.
            const newStarterPhrasesDiv = document.createElement('div');
            newStarterPhrasesDiv.id = 'starterPhrases'; // HTML에 정의된 ID와 동일하게 유지
            newStarterPhrasesDiv.className = 'flex flex-wrap gap-2';
            elements.starterPhrasesContainer.appendChild(newStarterPhrasesDiv);
            // elements.starterPhrasesElem = newStarterPhrasesDiv; // 이 참조는 더 이상 사용하지 않아도 됩니다.

            // 이제 새로 생성된 div에 버튼들을 추가합니다.
            starters.forEach(starter => {
                const button = document.createElement('button');
                button.className = "text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 px-2 py-1 rounded-md shadow-sm transition-colors";
                button.textContent = `"${starter}"`;
                // 동적으로 생성된 버튼에 직접 이벤트 리스너 연결
                button.onclick = () => { elements.userInputElem.value = starter; };
                newStarterPhrasesDiv.appendChild(button); // 새로 생성된 div에 추가
            });
        } else {
            elements.starterPhrasesContainer.classList.add('hidden');
        }

        // 사용자 설정 시나리오와 집중 연습 주제 입력 필드 표시/숨김 처리
        if (appState.currentScenario.id === "custom") {
            elements.customScenarioGroup.classList.remove('hidden');
            elements.focusTopicGroup.classList.add('hidden');
            elements.customScenarioInputElem.value = appState.currentCustomScenarioInput;
            elements.customScenarioInputElem.placeholder = appState.UI_TEXT.customScenarioPlaceholder;
        } else {
            elements.customScenarioGroup.classList.add('hidden');
            elements.focusTopicGroup.classList.remove('hidden');
            elements.focusTopicInput.value = appState.currentFocusTopic;
            elements.focusTopicInput.placeholder = appState.UI_TEXT.focusTopicPlaceholder;
        }

        // 시나리오 설명 영역의 하단 여백 및 제목 스타일 복구
        elements.scenarioDescriptionArea.classList.remove('hidden');
        elements.scenarioDescriptionArea.classList.add('pb-4', 'sm:pb-5');
        elements.scenarioTitleElem.classList.add('mb-1.5');
        elements.scenarioTitleElem.classList.remove('mb-0');
    }
}

/**
 * 앱의 모든 정적 버튼 및 UI 텍스트를 현재 언어에 맞춰 업데이트합니다.
 */
function updateAllButtonTexts() {
    elements.headerTitle.textContent = appState.UI_TEXT.appTitle; // 앱 제목
    elements.helpButton.title = appState.UI_TEXT.guideModalTitle.split(' ')[0]; // '도움말 보기' 대신 '사용 가이드'의 첫 단어 (임시)
    elements.newConversationButton.title = appState.UI_TEXT.newConversationAlert("").split(" ")[0]; // '새 대화 시작' (임시)
    elements.suggestRepliesButtonText.textContent = appState.UI_TEXT.suggestReplies;
    elements.analyzeSentenceButtonText.textContent = appState.UI_TEXT.analyzeSentence;
    elements.roleSwapButtonText.textContent = appState.UI_TEXT.roleSwapButtonText; // 역할 변경
    elements.userInputElem.placeholder = appState.UI_TEXT.customScenarioPlaceholder; // input 메시지 입력 부분 (임시)

    // 가이드 모달 텍스트 업데이트 (UI_TEXT의 상세 텍스트 사용)
    elements.guideModalTitle.textContent = appState.UI_TEXT.guideModalTitle;
    elements.guideP1.innerHTML = `<strong>1. 🤖 シナリオ選択:</strong><br/> ${appState.UI_TEXT.guideText1}`; // 일본어
    elements.guideP2.innerHTML = `<strong>2. 🎯 集中テーマ (任意):</strong><br/> ${appState.UI_TEXT.guideText2}`; // 일본어
    elements.guideP3.innerHTML = `<strong>3. 🗣️ 会話開始:</strong><br/> ${appState.UI_TEXT.guideText3}`; // 일본어

    elements.guideModalContent.querySelector('div.space-y-3 p:nth-of-type(4) strong').textContent = appState.UI_TEXT.guideText4_header; // "AI 기능 활용하기"
    elements.guideUl_item1_strong.textContent = appState.UI_TEXT.suggestReplies;
    elements.guideUl_item1_text.textContent = `: ${appState.UI_TEXT.guideText4_item1}`; // 앞의 `<strong>` 태그 뒤에 공백이 있을 수 있으므로 `nextSibling` 사용
    elements.guideUl_item2_strong.textContent = appState.UI_TEXT.analyzeSentence;
    elements.guideUl_item2_text.textContent = `: ${appState.UI_TEXT.guideText4_item2}`;
    elements.guideUl_item3_strong.textContent = appState.UI_TEXT.roleSwapButtonText;
    elements.guideUl_item3_text.textContent = `: ${appState.UI_TEXT.guideText4_item3}`;

    elements.guideP5.innerHTML = `<strong>5. 🔄 新しい会話を開始:</strong><br/> ${appState.UI_TEXT.guideText5}`; // 일본어

    elements.confirmGuideModalButton.textContent = appState.UI_TEXT.guideModalConfirmButton;

    // 분석 모달 텍스트 업데이트
    elements.analysisModalTitle.textContent = appState.UI_TEXT.analysisResultTitle;
    elements.englishFeedbackTitle.textContent = appState.UI_TEXT.englishFeedbackTitle;
    elements.koreanSummaryTitle.textContent = appState.UI_TEXT.koreanSummaryTitle;
    elements.confirmAnalysisModalButtonFromAnalysis.textContent = appState.UI_TEXT.analysisConfirmButton;

    // 언어 선택 드롭다운 텍스트 업데이트
    const langLinks = elements.languageDropdown.querySelectorAll('a');
    langLinks.forEach(link => {
        const langCode = link.dataset.lang;
        if (langPacks[langCode]) {
            link.textContent = langPacks[langCode].displayName;
        }
    });

    // 현재 언어 표시 업데이트
    elements.currentLanguageDisplay.textContent = langPacks[appState.currentLangCode].displayName;
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
    elements.suggestedRepliesList.innerHTML = '';
    elements.suggestedRepliesContainer.classList.add('hidden');
}

/**
 * 시나리오 선택 드롭다운을 렌더링합니다.
 */
function renderScenarioPicker() {
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
                    itemDiv.classList.add('scenario-picker-item-selected'); // 현재 선택된 아이템 스타일 적용
                }
                itemDiv.textContent = item.title;
                // 시나리오 아이템 클릭 이벤트
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
        renderScenarioPicker(); // 드롭다운 내용 렌더링
        elements.scenarioDropdown.classList.remove('hidden');
        elements.scenarioDropdown.classList.add('fade-in');
        // 시나리오 피커가 열리면 언어 피커는 닫기
        if (appState.showLanguagePicker) {
            toggleLanguagePicker();
        }
    } else {
        elements.scenarioDropdown.classList.add('hidden');
        appState.expandedCategories = {}; // 드롭다운 숨길 때 확장 상태 초기화
    }
}

/**
 * 언어 선택 드롭다운을 토글합니다.
 */
function toggleLanguagePicker() {
    appState.showLanguagePicker = !appState.showLanguagePicker;
    if (appState.showLanguagePicker) {
        elements.languageDropdown.classList.remove('hidden');
        elements.languageDropdown.classList.add('fade-in');
        // 언어 피커가 열리면 시나리오 피커는 닫기
        if (appState.showScenarioPicker) {
            toggleScenarioPicker();
        }
    } else {
        elements.languageDropdown.classList.add('hidden');
    }
}


// --- 모달 관련 함수 ---

/**
 * 사용 가이드 모달을 표시합니다.
 */
function showGuideModal() {
    elements.guideModal.classList.remove('hidden');
    elements.guideModal.classList.add('fade-in');
}

/**
 * 사용 가이드 모달을 닫고, 다시 표시하지 않도록 로컬 스토리지에 저장합니다.
 */
function closeGuideModal() {
    elements.guideModal.classList.add('hidden');
    localStorage.setItem(`guideShown_${APP_ID}`, 'true');
}

/**
 * 문장 분석 결과 모달을 표시합니다.
 * @param {string} combinedAnalysisText - 영어 분석 결과와 한국어 요약이 포함된 텍스트
 */
function showAnalysisModal(combinedAnalysisText) {
    const koreanSummaryMarker = appState.UI_TEXT.koreanSummaryTitle; // "🇰🇷 한국어 요약:"
    const koreanSummaryIndex = combinedAnalysisText.indexOf(koreanSummaryMarker);

    let engAnalysis = "";
    let korSummary = "";

    if (koreanSummaryIndex !== -1) {
        // 한국어 요약 마커 기준으로 영어 분석과 한국어 요약 분리
        engAnalysis = combinedAnalysisText.substring(0, koreanSummaryIndex).trim();
        korSummary = combinedAnalysisText.substring(koreanSummaryIndex + koreanSummaryMarker.length).trim();
    } else {
        // 마커가 없을 경우 전체를 영어 분석으로 간주
        engAnalysis = combinedAnalysisText.trim();
        korSummary = "한국어 요약을 생성하지 못했습니다."; // 또는 다른 기본 메시지
    }

    elements.englishAnalysisResultDiv.innerHTML = simpleMarkdownToHtml(engAnalysis);
    elements.koreanAnalysisResultDiv.innerHTML = simpleMarkdownToHtml(korSummary);

    elements.analysisModal.classList.remove('hidden');
    elements.analysisModal.classList.add('fade-in');
}

/**
 * 문장 분석 결과 모달을 닫고 내용을 초기화합니다.
 */
function closeAnalysisModal() {
    elements.analysisModal.classList.add('hidden');
    elements.englishAnalysisResultDiv.innerHTML = '';
    elements.koreanAnalysisResultDiv.innerHTML = '';
}

// --- Firebase 서비스 함수 ---

/**
 * Firebase를 초기화하고 익명 인증을 처리합니다.
 * @returns {Promise<void>} 인증 완료 시 resolve
 */
async function initFirebase() {
    const firebaseApp = initializeApp(FIREBASE_CONFIG);
    appState.auth = getAuth(firebaseApp);
    appState.db = getFirestore(firebaseApp);

    return new Promise((resolve, reject) => {
        // Firebase 인증 상태 변경 감지
        onAuthStateChanged(appState.auth, async (user) => {
            if (user) {
                // 이미 로그인된 사용자
                appState.currentUserId = user.uid;
                resolve();
            } else {
                try {
                    // 커스텀 토큰이 제공되면 사용
                    if (typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
                        const userCredential = await signInWithCustomToken(appState.auth, window.__initial_auth_token);
                        appState.currentUserId = userCredential.user.uid;
                    } else {
                        // 익명 로그인 시도
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

/**
 * 사용자 프로필 데이터를 Firestore에서 가져옵니다.
 * @param {string} userId - 사용자 ID
 * @param {string} appId - 앱 ID
 * @returns {object|null} 사용자 프로필 데이터 또는 null
 */
async function getUserProfile(userId, appId) {
    if (!appState.db) {
        console.error("Firestore가 초기화되지 않았습니다.");
        return null; // DB 미초기화 시 null 반환 또는 에러 throw
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
        console.error("Firestore가 초기화되지 않았습니다.");
        return; // DB 미초기화 시 함수 종료
    }
    const userProfileRef = doc(appState.db, `artifacts/${appId}/users/${userId}/profile`, 'info');
    const updateData = {
        lastLogin: serverTimestamp(), // 서버 타임스탬프 (마지막 로그인 시간)
        lastScenarioId: lastScenarioId,
        lastRoleIsUserPrimary: lastRoleIsUserPrimary,
    };

    // 사용자 정의 시나리오일 경우 관련 정보 저장
    if (lastScenarioId === "custom" && lastCustomScenarioDetails) {
        updateData.lastCustomScenarioDetails = {
            title: appState.UI_TEXT.scenarioTitleCustom(lastCustomScenarioDetails), // UI_TEXT에서 제목 생성 함수 사용
            description: lastCustomScenarioDetails
        };
        // 커스텀 시나리오일 경우 focusTopic은 저장하지 않음
        if (updateData.lastFocusTopic !== undefined) delete updateData.lastFocusTopic;
    } else if (lastScenarioId !== "custom") {
        // 일반 시나리오일 경우 집중 주제 저장
        updateData.lastFocusTopic = lastFocusTopic;
        // 일반 시나리오일 경우 customScenarioDetails는 저장하지 않음
        if (updateData.lastCustomScenarioDetails !== undefined) delete updateData.lastCustomScenarioDetails;
    }

    try {
        await setDoc(userProfileRef, updateData, { merge: true }); // merge: true로 기존 필드 유지하고 지정된 필드만 업데이트
    } catch (error) {
        console.error("사용자 프로필 업데이트 오류:", error);
        throw error;
    }
}

/**
 * 메시지를 Firestore에 저장합니다.
 * @param {string} collectionPath - 메시지를 저장할 Firestore 컬렉션 경로
 * @param {object} messageData - 저장할 메시지 데이터
 * @returns {Promise<DocumentReference>} 저장된 문서에 대한 참조
 */
async function saveMessage(collectionPath, messageData) {
    if (!appState.db || !appState.currentUserId) {
        console.error("Firebase가 초기화되지 않았거나 사용자가 인증되지 않았습니다.");
        throw new Error("Firebase is not initialized or user is not authenticated.");
    }
    return addDoc(collection(appState.db, collectionPath), { ...messageData, timestamp: serverTimestamp() });
}

// --- 외부 API 통신 함수 ---

/**
 * AI (Gemini) API를 호출하여 응답을 받습니다.
 * @param {string} prompt - AI에 전달할 프롬프트
 * @returns {Promise<string>} AI 응답 텍스트
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
            let errorDetails = `サーバー応答: ${response.statusText || '不明なエラー'}`; // 일본어 에러 메시지
            try {
                const errorData = await response.json();
                errorDetails = errorData.error || errorData.message || (typeof errorData === 'object' ? JSON.stringify(errorData) : String(errorData));
                if (!errorDetails || errorDetails === '{}' || errorDetails.trim() === "") {
                    errorDetails = `サーバー応答: ${response.statusText || 'エラー内容なし'}`; // 일본어 에러 메시지
                }
            } catch (jsonError) {
                console.warn("APIエラー応答がJSONではないため、テキストとして読み込もうとします。", jsonError); // 일본어 콘솔 메시지
                try {
                    const errorText = await response.text();
                    errorDetails = errorText.trim() || `サーバー応答: ${response.statusText || 'エラー内容なし'}`; // 일본어 에러 메시지
                } catch (textError) {
                    console.error("APIエラー応答をテキストとして読み込むのに失敗しました。", textError); // 일본어 콘솔 메시지
                    errorDetails = `サーバー応答: ${response.statusText || '不明なエラー'}、応答本文の読み込み失敗`; // 일본어 에러 메시지
                }
            }
            const errorMsg = `APIリクエスト失敗 (${response.status}): ${errorDetails}`; // 일본어 에러 메시지
            console.error("API Error Details:", errorDetails);
            throw new Error(errorMsg);
        }

        const result = await response.json();
        // 응답 형식에 따라 적절한 텍스트 추출
        if (result.text) {
            return result.text;
        } else if (result.generated_text) {
            return result.generated_text;
        } else if (result.reply) {
            return result.reply;
        } else if (typeof result === 'string') {
            return result;
        } else if (result.candidates && result.candidates[0]?.content?.parts[0]?.text) {
            console.warn("Gemini API形式の応答を受け取りました。Glitchエンドポイントがこの形式をサポートしているか確認してください。"); // 일본어 콘솔 메시지
            return result.candidates[0].content?.parts[0]?.text || '';
        } else {
            console.error("API応答からテキストを抽出できませんでした、または予期しない構造です:", result); // 일본어 콘솔 메시지
            throw new Error('AIから有効なテキスト応答を受け取っていません。'); // 일본어 에러 메시지
        }
    } catch (error) {
        console.error("API呼び出し中に例外が発生しました:", error); // 일본어 콘솔 메시지
        throw error;
    }
}

// --- 이벤트 핸들러 함수 ---

/**
 * 메시지 전송 버튼 클릭 또는 Enter 키 입력 시 호출됩니다.
 */
async function handleSendMessage() {
    // 입력창이 비어있거나 AI가 응답 중일 때는 실행하지 않음
    if (elements.userInputElem.value.trim() === '' || appState.isLoading) return;

    // 사용자 정의 시나리오이고 내용이 비어있으며 첫 메시지일 경우 경고
    if (appState.currentScenario.id === "custom" && elements.customScenarioInputElem.value.trim() === '' && appState.currentMessages.length === 0) {
        alert(appState.UI_TEXT.customScenarioInputRequired);
        return;
    }

    // 새 사용자 메시지 생성 및 상태에 추가
    const newUserMessage = { sender: 'user', text: elements.userInputElem.value.trim(), timestamp: new Date() };
    appState.currentMessages.push(newUserMessage);
    renderMessages(); // 메시지 화면 렌더링
    const currentInputForAPI = elements.userInputElem.value; // API 호출을 위해 현재 입력 값 저장
    clearInput('userInputElem'); // 입력창 비우기

    appState.isLoading = true; // 로딩 상태 활성화
    setSendMessageLoadingState(true); // 전송 버튼 로딩 UI 표시

    hideSuggestedReplies(); // 응답 제안 숨김
    closeAnalysisModal(); // 분석 모달 닫기
    updateScenarioDisplay(true); // 대화 시작 후 시나리오 설명 영역 숨김

    // Firebase에 사용자 메시지 저장
    if (appState.currentUserId) {
        try {
            // 사용자 정의 시나리오일 경우 고유한 대화 경로 생성
            const conversationPath = `artifacts/${APP_ID}/users/${appState.currentUserId}/conversations/${appState.currentScenario.id === "custom" ? `custom_${elements.customScenarioInputElem.value.substring(0,10).replace(/\s/g, '_')}` : appState.currentScenario.id}/messages`;
            await saveMessage(conversationPath, newUserMessage);
        } catch (error) {
            console.error("사용자 메시지 저장 오류:", error);
        }
    }

    // AI 컨텍스트 및 대화 이력 구성
    const contextForAI = getDynamicContext(
        appState.currentScenario,
        appState.currentCustomScenarioInput,
        appState.currentFocusTopic,
        appState.userIsPlayingPrimaryRole
    );

    let conversationHistoryForAPI = "Previous conversation:\n"; // AI 프롬프트에 전달할 이력 (영어로 유지)
    // 최근 3턴 (사용자 메시지 3개 + AI 메시지 3개)의 대화 이력을 포함
    appState.currentMessages.slice(Math.max(0, appState.currentMessages.length - 7), -1).forEach(msg => {
        conversationHistoryForAPI += `${msg.sender === 'user' ? 'User' : 'AI'}: ${msg.text}\n`;
    });

    // AI에게 보낼 최종 프롬프트 (System Instruction, Previous conversation, User Input)
    const promptForAI = `System Instruction: ${contextForAI}\n\n${appState.currentMessages.length > 1 ? conversationHistoryForAPI : ''}User: ${currentInputForAPI}`;

    try {
        const aiResponseText = await callGeminiAPI(promptForAI); // AI API 호출
        const newAiMessage = { sender: 'ai', text: aiResponseText, timestamp: new Date() };
        appState.currentMessages.push(newAiMessage); // AI 응답 상태에 추가
        renderMessages(); // AI 응답 화면 렌더링

        // Firebase에 AI 메시지 저장
        if (appState.currentUserId) {
            const conversationPath = `artifacts/${APP_ID}/users/${appState.currentUserId}/conversations/${appState.currentScenario.id === "custom" ? `custom_${elements.customScenarioInputElem.value.substring(0,10).replace(/\s/g, '_')}` : appState.currentScenario.id}/messages`;
            await saveMessage(conversationPath, newAiMessage);
        }
    } catch (error) {
        // API 오류 발생 시 오류 메시지 표시
        appState.currentMessages.push({ sender: 'ai', text: `${appState.UI_TEXT.aiResponseError} ${error.message}`, timestamp: new Date() });
        renderMessages();
    } finally {
        appState.isLoading = false; // 로딩 상태 비활성화
        setSendMessageLoadingState(false); // 전송 버튼 로딩 UI 해제
    }
}

/**
 * AI 응답 제안 버튼 클릭 시 호출됩니다.
 */
async function handleSuggestReplies() {
    // 이미 로딩 중이거나 메시지가 없을 경우 실행하지 않음
    if (appState.isLoadingSuggestions || appState.currentMessages.length === 0) return;
    const lastMessage = appState.currentMessages[appState.currentMessages.length - 1];
    // 마지막 메시지가 AI의 응답이 아닐 경우 경고
    if (lastMessage.sender !== 'ai') {
        alert(appState.UI_TEXT.suggestionsAfterAiResponse);
        return;
    }

    appState.isLoadingSuggestions = true; // 로딩 상태 활성화
    setLoadingState('suggestRepliesButton', appState.UI_TEXT.loading, true); // 버튼 로딩 UI 표시
    closeAnalysisModal(); // 분석 모달 닫기

    try {
        const scenarioTitleForPrompt = appState.currentScenario.id === "custom" ? (appState.currentCustomScenarioInput || appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)) : appState.currentScenario.title;
        const focusTopicForPrompt = appState.currentScenario.id === "custom" ? "" : (appState.currentFocusTopic ? `ユーザーはさらに「${appState.currentFocusTopic}」に焦点を当てたいと考えています。` : ''); // 일본어

        // AI 응답 제안을 위한 프롬프트 구성 (AI가 응답할 언어, 즉 일본어)
        const prompt = `AIチューターの最後のメッセージ「${lastMessage.text}」に基づき、ユーザー（日本語学習者）が次に言うことができる、多様で自然な響きの返信を3つだけ（短〜中程度の長さで）、「${scenarioTitleForPrompt}」シナリオで提供してください。${focusTopicForPrompt} 厳密に番号付きリスト形式で、各項目を数字とピリオドで始めてください（例：1. 提案1）。リストの前後に導入文や説明文を含めないでください。ユーザーの現在の役割を考慮してください：${appState.userIsPlayingPrimaryRole ? '彼らはシナリオの主要な登場人物です（例：客、患者）' : '彼らはAIチューター/スタッフの役割を演じています'}。`; // 일본어
        const suggestionsText = await callGeminiAPI(prompt); // AI API 호출

        // AI 응답에서 제안 목록 파싱
        let parsedSuggestions = suggestionsText.split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0 && /^\d+\.\s*.+/.test(s))
            .map(s => s.replace(/^\d+\.\s*/, '').trim())
            .filter(s => s.length > 0 && !s.toLowerCase().startsWith("here are") && !s.toLowerCase().includes("suggestion for")); // 불필요한 문구 필터링

        elements.suggestedRepliesList.innerHTML = ''; // 기존 제안 목록 초기화
        if (parsedSuggestions.length > 0) {
            parsedSuggestions.slice(0,3).forEach(reply => {
                const li = document.createElement('li');
                li.className = "text-xs sm:text-sm text-sky-700 hover:text-sky-800 cursor-pointer p-1.5 bg-white rounded-md shadow-sm hover:shadow-md transition-shadow";
                li.textContent = `"${reply}"`;
                // 제안 클릭 시 입력창에 적용 및 제안 목록 숨김
                li.onclick = () => {
                    elements.userInputElem.value = reply;
                    hideSuggestedReplies();
                };
                elements.suggestedRepliesList.appendChild(li);
            });
            elements.suggestedRepliesContainer.classList.remove('hidden');
            elements.suggestedRepliesContainer.classList.add('fade-in');
        } else {
            elements.suggestedRepliesList.innerHTML = `<li class="text-slate-500">${appState.UI_TEXT.errorMessageSuggestions}</li>`;
            elements.suggestedRepliesContainer.classList.remove('hidden');
        }
    } catch (error) {
        elements.suggestedRepliesList.innerHTML = `<li class="text-red-500">${appState.UI_TEXT.errorMessageSuggestions} ${error.message}</li>`;
        elements.suggestedRepliesContainer.classList.remove('hidden');
    } finally {
        appState.isLoadingSuggestions = false; // 로딩 상태 비활성화
        setLoadingState('suggestRepliesButton', '', false); // 버튼 로딩 UI 해제
    }
}

/**
 * 문장 분석 버튼 클릭 시 호출됩니다.
 */
async function handleAnalyzeSentence() {
    // 이미 로딩 중이거나 사용자 메시지가 없을 경우 실행하지 않음
    if (appState.isLoadingAnalysis) return;
    const userMessages = appState.currentMessages.filter(msg => msg.sender === 'user');
    if (userMessages.length === 0) {
        alert(appState.UI_TEXT.noUserMessageForAnalysis);
        return;
    }

    appState.isLoadingAnalysis = true; // 로딩 상태 활성화
    setLoadingState('analyzeSentenceButton', appState.UI_TEXT.loading, true); // 버튼 로딩 UI 표시
    hideSuggestedReplies(); // 응답 제안 숨김
    closeAnalysisModal(); // 기존 분석 모달 닫기

    try {
        const lastUserMessage = userMessages[userMessages.length - 1]; // 가장 최근 사용자 메시지
        const scenarioTitleForPrompt = appState.currentScenario.id === "custom" ? (appState.currentCustomScenarioInput || appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)) : appState.currentScenario.title;
        const focusTopicForPrompt = appState.currentScenario.id === "custom" ? "" : (appState.currentFocusTopic ? `ユーザーはさらに「${appState.currentFocusTopic}」に焦点を当てたいと考えています。` : ''); // 일본어

        // 문장 분석을 위한 프롬프트 구성 (영어 피드백, 한국어 요약 요청)
        // 사용자가 일본어를 입력했으므로, AI는 입력된 일본어에 대한 피드백을 영어로, 요약을 한국어로 제공해야 합니다.
        const analysisPrompt = `The user (learning Japanese) said: "${lastUserMessage.text}" in the context of "${scenarioTitleForPrompt}" scenario. ${focusTopicForPrompt} Provide a structured analysis in English: **⭐ Overall Impression:** (Brief positive comment or general feel) **👍 Strengths:** (What was good about the sentence) **💡 Areas for Improvement:** **Grammar:** (Specific errors & corrections. If none, say "Grammar is good.") **Vocabulary:** (Word choice suggestions, better alternatives. If good, say "Vocabulary is appropriate.") **Naturalness/Fluency:** (Tips to sound more natural. If good, say "Sounds natural.") **✨ Suggested Revision (if any):** (Offer a revised version of the sentence if significant improvements can be made) Keep feedback constructive and easy for a Japanese learner. After the English analysis, provide a concise summary of the feedback in Korean, under a heading "${appState.UI_TEXT.koreanSummaryTitle}". This summary should highlight the main points of the feedback for a beginner to understand easily.`; // AI 프롬프트
        const combinedAnalysisText = await callGeminiAPI(analysisPrompt); // AI API 호출
        showAnalysisModal(combinedAnalysisText); // 분석 결과 모달에 표시
    } catch (error) {
        elements.englishAnalysisResultDiv.textContent = `${appState.UI_TEXT.errorMessageAnalysis} ${error.message}`;
        elements.koreanAnalysisResultDiv.textContent = "";
        elements.analysisModal.classList.remove('hidden');
        elements.analysisModal.classList.add('fade-in');
    } finally {
        appState.isLoadingAnalysis = false; // 로딩 상태 비활성화
        setLoadingState('analyzeSentenceButton', '', false); // 버튼 로딩 UI 해제
    }
}

/**
 * 역할 변경 버튼 클릭 시 호출됩니다.
 */
function handleRoleSwap() {
    if (appState.isLoading) {
        alert(appState.UI_TEXT.scenarioChangeLoadingAlert); // AI 응답 중에는 역할 변경 불가
        return;
    }
    appState.userIsPlayingPrimaryRole = !appState.userIsPlayingPrimaryRole; // 역할 상태 토글
    appState.currentMessages = []; // 대화 기록 초기화
    renderMessages(); // 메시지 화면 초기화
    clearInput('userInputElem'); // 입력창 비우기
    hideSuggestedReplies(); // 응답 제안 숨김
    closeAnalysisModal(); // 분석 모달 닫기
    updateScenarioDisplay(false); // 시나리오 설명 영역 업데이트 (새로운 역할에 맞춰)

    // 역할 변경 알림 메시지 생성
    const currentRoleDescription = appState.userIsPlayingPrimaryRole ?
        (appState.currentScenario.id === "custom" ? '直接入力した状況の主要な役割' : `「${appState.currentScenario.title}」状況の主要な役割（例：お客さん、患者）`) : // 일본어
        (appState.currentScenario.id === "custom" ? '直接入力した状況のAIの役割' : `「${appState.currentScenario.title}」状況のAIの役割（例：店員、医者）`); // 일본어

    alert(appState.UI_TEXT.roleChangeAlert(currentRoleDescription));

    // 역할 변경 후 AI가 먼저 말을 걸도록 하는 선택적 로직
    // if (!appState.userIsPlayingPrimaryRole && appState.currentMessages.length === 0 && appState.currentScenario.id !== 'custom') {
    //     const aiGreeting = getStarterPhrases(appState.currentScenario, false)[0] || "こんにちは！何かお手伝いできますか？"; // 일본어
    //     appState.currentMessages.push({ sender: 'ai', text: aiGreeting, timestamp: new Date() });
    //     renderMessages();
    // }
}

/**
 * 새 대화 시작 버튼 클릭 시 호출됩니다.
 */
function handleNewConversation() {
    if (appState.isLoading) {
        alert(appState.UI_TEXT.newConversationLoadingAlert); // AI 응답 중에는 새 대화 시작 불가
        return;
    }
    appState.currentMessages = []; // 대화 기록 초기화
    renderMessages(); // 메시지 화면 초기화
    clearInput('userInputElem'); // 입력창 비우기
    hideSuggestedReplies(); // 응답 제안 숨김
    closeAnalysisModal(); // 분석 모달 닫기
    appState.userIsPlayingPrimaryRole = true; // 새 대화 시작 시 기본 역할로 초기화
    updateScenarioDisplay(false); // 시나리오 설명 영역 다시 보이게

    // 새 대화 시작 알림 메시지
    const scenarioTitleForAlert = appState.currentScenario.id === 'custom' ? (appState.currentCustomScenarioInput || appState.UI_TEXT.scenarioTitleCustom(appState.currentCustomScenarioInput)) : appState.currentScenario.title;
    alert(appState.UI_TEXT.newConversationAlert(scenarioTitleForAlert));
}

/**
 * 시나리오 선택 드롭다운에서 시나리오 아이템 클릭 시 호출됩니다.
 * @param {object} scenarioItem - 선택된 시나리오 아이템 객체
 */
function handleScenarioSelect(scenarioItem) {
    if (appState.isLoading) {
        alert(appState.UI_TEXT.scenarioChangeLoadingAlert); // AI 응답 중에는 시나리오 변경 불가
        return;
    }
    const fullScenarioDetails = findScenarioById(scenarioItem.id); // 현재 언어의 시나리오 데이터에서 찾음
    appState.currentScenario = fullScenarioDetails; // 현재 시나리오 업데이트
    appState.currentMessages = []; // 대화 기록 초기화
    clearInput('userInputElem'); // 입력창 비우기
    hideSuggestedReplies(); // 응답 제안 숨김
    closeAnalysisModal(); // 분석 모달 닫기
    appState.userIsPlayingPrimaryRole = true; // 시나리오 변경 시 기본 역할로 초기화

    // 시나리오 유형에 따라 관련 입력 필드 상태 초기화
    if (scenarioItem.id !== "custom") {
        appState.currentCustomScenarioInput = '';
        clearInput('customScenarioInputElem');
    } else {
        appState.currentFocusTopic = '';
        clearInput('focusTopicInput');
    }
    updateScenarioDisplay(false); // 시나리오 설명 영역 업데이트 (새 시나리오에 맞춰)
    renderMessages(); // 메시지 화면 초기화
    toggleScenarioPicker(); // 드롭다운 닫기
}

/**
 * 언어를 변경하는 함수입니다.
 * @param {string} langCode - 변경할 언어 코드 ('ko', 'ja' 등)
 */
function setLanguage(langCode) {
    if (!langPacks[langCode]) {
        console.error(`Unsupported language code: ${langCode}`);
        return;
    }

    appState.currentLangCode = langCode;
    appState.SCENARIO_DATA = langPacks[langCode].scenarios; // 시나리오 데이터 변경
    appState.UI_TEXT = langPacks[langCode].ui; // UI 텍스트 변경

    localStorage.setItem('speakup_ai_lang', langCode); // 로컬 스토리지에 언어 설정 저장

    // UI 텍스트 업데이트
    updateAllButtonTexts();
    // 시나리오 관련 UI 업데이트 (현재 시나리오 유지하면서 언어만 변경)
    // 현재 시나리오 객체의 description, title 등이 바뀔 수 있으므로 다시 할당하여 UI를 업데이트
    // 이전에 로드된 currentScenario.id를 사용하여 새 언어 팩에서 해당 시나리오를 다시 찾습니다.
    appState.currentScenario = findScenarioById(appState.currentScenario?.id || "cafe"); // currentScenario가 null일 경우 'cafe'로 대체
    if (!appState.currentScenario) { // 혹시 로드된 시나리오가 없다면 기본값으로 설정
         appState.currentScenario = findScenarioById("cafe");
    }
    updateScenarioDisplay(false); // 시나리오 UI 텍스트 업데이트
    renderScenarioPicker(); // 시나리오 드롭다운 텍스트 업데이트
    elements.currentLanguageDisplay.textContent = langPacks[langCode].displayName; // 언어 선택 버튼 텍스트 업데이트
}

// --- 모든 이벤트 리스너 설정 함수 ---

/**
 * 모든 DOM 요소에 이벤트 리스너를 연결합니다.
 */
function attachEventListeners() {
    elements.scenarioPickerButton.addEventListener('click', toggleScenarioPicker);
    elements.newConversationButton.addEventListener('click', handleNewConversation);
    elements.helpButton.addEventListener('click', showGuideModal);

    elements.closeGuideModalButton.addEventListener('click', closeGuideModal);
    elements.confirmGuideModalButton.addEventListener('click', closeGuideModal);

    elements.sendMessageButton.addEventListener('click', handleSendMessage);
    elements.userInputElem.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !appState.isLoading) {
            handleSendMessage();
        }
    });
    elements.suggestRepliesButton.addEventListener('click', handleSuggestReplies);
    elements.analyzeSentenceButton.addEventListener('click', handleAnalyzeSentence);
    elements.roleSwapButton.addEventListener('click', handleRoleSwap);

    elements.closeAnalysisModalButtonFromAnalysis.addEventListener('click', closeAnalysisModal);
    elements.confirmAnalysisModalButtonFromAnalysis.addEventListener('click', closeAnalysisModal);

    // 입력 필드 변경 이벤트 (상태 업데이트)
    elements.focusTopicInput.addEventListener('change', (e) => { appState.currentFocusTopic = e.target.value; });
    elements.customScenarioInputElem.addEventListener('change', (e) => {
        appState.currentCustomScenarioInput = e.target.value;
        updateScenarioDisplay(); // 사용자 정의 시나리오 설명 업데이트를 위해 호출
    });

    // 언어 선택 드롭다운 토글
    elements.languagePickerButton.addEventListener('click', toggleLanguagePicker);
    // 언어 선택 링크 클릭 (이벤트 위임)
    elements.languageDropdown.addEventListener('click', (event) => {
        event.preventDefault(); // 기본 링크 동작 방지
        const target = event.target.closest('a'); // 클릭된 요소 또는 가장 가까운 <a> 태그 찾기
        if (target && target.dataset.lang) {
            const langCode = target.dataset.lang;
            setLanguage(langCode);
            toggleLanguagePicker(); // 드롭다운 닫기
        }
    });

    // 문서 전체 클릭 시 드롭다운/모달 닫기 로직
    document.addEventListener('click', (event) => {
        // 시나리오 드롭다운 외부 클릭 시 닫기
        if (elements.scenarioPickerContainer && !elements.scenarioPickerContainer.contains(event.target) && appState.showScenarioPicker) {
            toggleScenarioPicker();
        }
        // 언어 드롭다운 외부 클릭 시 닫기
        if (elements.languagePickerContainer && !elements.languagePickerContainer.contains(event.target) && appState.showLanguagePicker) {
            toggleLanguagePicker();
        }
        // 분석 모달 외부 클릭 시 닫기
        if (elements.analysisModalContent && !elements.analysisModalContent.contains(event.target) &&
            elements.analysisModal && !elements.analysisModal.classList.contains('hidden')) {
            closeAnalysisModal();
        }
        // 가이드 모달 외부 클릭 시 닫기
        if (elements.guideModalContent && !elements.guideModalContent.contains(event.target) &&
            elements.guideModal && !elements.guideModal.classList.contains('hidden')) {
            closeGuideModal();
        }
    });
}

// --- 앱 초기화 로직 ---
document.addEventListener('DOMContentLoaded', async () => {
    initDOMElements(); // 1. DOM 요소 캐싱
    attachEventListeners(); // 2. 모든 이벤트 리스너 연결

    // 3. 언어 설정 로드 및 적용
    const savedLang = localStorage.getItem('speakup_ai_lang') || 'ko'; // 기본값 한국어
    setLanguage(savedLang); // 이 시점에서 appState.SCENARIO_DATA 및 UI_TEXT가 설정됨

    await initFirebase(); // 4. Firebase 초기화 및 사용자 인증

    // 5. 사용자 프로필 로드 및 앱 상태 초기화
    if (appState.currentUserId) {
        try {
            const userProfile = await getUserProfile(appState.currentUserId, APP_ID);
            let loadedScenarioData = findScenarioById("cafe"); // 기본값 '카페에서' (현재 로드된 언어의 SCENARIO_DATA 사용)

            if (userProfile) {
                const lastScenarioId = userProfile.lastScenarioId;
                const foundScenarioFromDB = findScenarioById(lastScenarioId); // 현재 언어의 SCENARIO_DATA에서 찾음

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

            // 사용자 프로필 업데이트 (마지막 로그인 시간, 현재 시나리오 등)
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
            appState.currentScenario = findScenarioById("cafe"); // 오류 발생 시 기본 시나리오로 설정
        }
    } else {
        appState.currentScenario = findScenarioById("cafe"); // 인증 실패 시 기본 시나리오로 설정
    }

    // 6. 초기 UI 렌더링 (언어 로드 후 시나리오 로드 후)
    updateScenarioDisplay(false); // 대화 시작 전이므로 설명 영역 표시
    renderMessages(); // 빈 메시지 컨테이너 렌더링

    // 7. 가이드 모달 표시 여부 확인 (로컬 스토리지 사용)
    if (!localStorage.getItem(`guideShown_${APP_ID}`)) {
        showGuideModal();
    }
});
