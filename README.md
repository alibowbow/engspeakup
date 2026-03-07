# SpeakUp Studio

`engspeakup`를 전면 재구성한 고급 영어 회화 훈련 앱입니다.

## 핵심 변화

- 단일 HTML 앱에서 React + Vite 기반 모듈형 SPA로 재구성
- Gemini API 키를 앱 안에서 직접 입력하고 로컬에만 저장 가능
- 시나리오/미션/표현/어휘를 포함한 대규모 콘텐츠 라이브러리 제공
- 대화 연습, 답변 추천, 문장 분석, 세션 요약, 복습, 통계까지 한 번에 제공
- 즐겨찾기, 어휘 뱅크, 세션 히스토리, JSON 내보내기/가져오기 지원
- 브라우저 음성 입력과 음성 재생 지원

## 실행

```bash
npm install
npm run dev
```

브라우저에서 표시되는 주소를 열고, 우측 설정 패널에서 Gemini API 키를 입력한 뒤 사용하면 됩니다.

## 빌드

```bash
npm run build
```

## API 키 정책

- API 키는 사용자가 직접 입력합니다.
- `API 키 저장`을 켜면 브라우저 `localStorage`에만 저장됩니다.
- 내보내기 JSON에는 API 키가 포함되지 않습니다.
