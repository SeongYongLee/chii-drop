import { AUTOMATIC_MATCHMAKING } from './features.js';

// 온라인 화면은 메인 게임 문서 안에 한 번만 만든다.
export const onlineTemplate = `
  <a class="skip-link" href="#main">본문으로 건너뛰기</a>
  <header class="topbar">
    <a href="#menu" data-online-exit class="back" aria-label="메인 메뉴로 돌아가기"><span aria-hidden="true">←</span> 메인 메뉴</a>
    <h1 class="brand-title"><a class="brand" href="#play"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>온라인 모드</a></h1>
    <div id="queue-banner" class="queue-banner" hidden><span id="queue-banner-status" role="status" aria-live="polite">상대 찾는 중…</span><button id="queue-banner-cancel" type="button" aria-label="자동 매칭 취소">취소</button></div>
    <div class="header-tools"><button id="touch-options" class="quiet" type="button" aria-label="터치 조작 옵션">⚙ 옵션</button>
    <span id="connection" class="connection">연결 중…</span></div>
  </header>
  <main id="main">
    <section id="player-panel" class="profile" aria-label="내 플레이어">
      <div class="player-avatar" aria-hidden="true"><canvas id="lobby-avatar" width="192" height="192"></canvas></div>
      <div class="profile-name"><span class="eyebrow">오늘도 한 판!</span><h2 id="my-name">플레이어 연결 중…</h2></div>
      <div class="profile-score"><strong id="my-rating">1500</strong><span id="my-record">시작 레이트</span></div>
      <details class="profile-edit"><summary>프로필 설정</summary><div class="profile-popover">
        <form id="name-form"><label for="nickname">닉네임</label><div class="inline"><input id="nickname" name="nickname" maxlength="16" autocomplete="nickname" required><button id="rename" disabled>저장</button></div></form>
        <p class="hint">기록은 이 브라우저의 플레이어 키와 연결됩니다. 브라우저 데이터를 지우면 다시 접속할 수 없어요.</p>
      </div></details>
    </section>
    <div class="status-bar"><span class="status-dot" aria-hidden="true"></span><p id="status" role="status" aria-live="polite">서버에 연결하고 있어요…</p></div>
    <section id="lobby-view" aria-label="온라인 로비">
      <nav id="lobby-tabs" class="lobby-tabs" aria-label="온라인 메뉴">
        <a id="tab-play" href="#play" aria-current="page"><span aria-hidden="true">◉</span> 대전</a>
        <a id="tab-create" href="#new-room"><span aria-hidden="true">＋</span> 방 만들기</a>
        <a id="tab-rankings" href="#leaderboard"><span aria-hidden="true">♜</span> 랭킹</a>
      </nav>
      <section id="panel-play" class="lobby-panel" aria-labelledby="play-title">
        <div class="page-heading"><div><span class="eyebrow">PLAY TOGETHER</span><h2 id="play-title">함께하면 더 즐거운 한 판</h2><p class="hint">방을 만들거나, 마음에 드는 방에 들어가 보세요.</p></div></div>
        <section class="matchmaking" aria-labelledby="match-title" ${AUTOMATIC_MATCHMAKING ? '' : 'hidden'}>
          <div class="match-copy"><span class="pill">온라인 로비</span><h3 id="match-title">같이 한 판 할까요?</h3><p>방에 참가하거나, 바로 상대를 찾아보세요.</p></div>
          <div class="match-actions"><label class="sr-only" for="queue-mode">자동 매칭 종류</label><select id="queue-mode" name="queue-mode"><option value="rated">랭크전 · 레이트 변경</option><option value="casual">친선전 · 레이트 유지</option></select><button id="matchmake" class="primary" disabled>상대 찾기 <span aria-hidden="true">→</span></button><button id="cancel-match" hidden>매칭 취소</button><p id="queue-status" hidden>상대를 찾고 있어요…</p></div>
          <div class="match-art" aria-hidden="true"><canvas id="lobby-mascots" width="384" height="160"></canvas></div>
        </section>
        <section class="card rooms-card" aria-labelledby="rooms-title">
          <div class="section-head"><div><h3 id="rooms-title">열려 있는 방 <span id="room-count" class="count">0</span></h3><p class="hint">대전·관전을 합쳐 방마다 최대 6명.</p></div><div class="inline"><button id="refresh" class="quiet" disabled aria-label="방 목록 새로고침">↻ <span class="refresh-label">새로고침</span></button><a href="#new-room" class="button primary">＋ 방 만들기</a></div></div>
          <div class="room-tools"><div class="room-filters" role="group" aria-label="방 종류 필터"><button data-room-filter="all" aria-pressed="true">전체</button><button data-room-filter="rated" aria-pressed="false">랭크전</button><button data-room-filter="casual" aria-pressed="false">친선전</button></div><label class="room-search"><span class="sr-only">방 이름 검색</span><input id="room-search" name="room-search" type="search" autocomplete="off" placeholder="방 이름 검색…"></label></div>
          <div id="rooms" class="room-list"><div class="empty"><span class="empty-symbol" aria-hidden="true">◌</span><strong>방 목록을 불러오는 중이에요</strong><p>연결되면 참가할 수 있는 방이 나타나요.</p></div></div>
          <div class="room-list-footer"><span class="hint">친구에게 초대받았나요?</span><button id="open-code" class="quiet" type="button">코드로 참가 →</button></div>
        </section>
        <p class="lobby-footnote">대전은 1대1, 관전자를 포함한 방 입장은 최대 6명이에요.</p>
      </section>
      <section id="panel-create" class="lobby-panel" aria-labelledby="create-title" hidden>
        <div class="page-heading"><div><span class="eyebrow">함께 즐기는 한 판</span><h2 id="create-title">방 만들기</h2><p class="hint">친구를 초대해도, 새로운 상대를 기다려도 좋아요.</p></div></div>
        <div class="create-layout"><section class="card create-card"><form id="create-form" class="create-form">
          <label>방 이름<input id="room-name" name="room-name" maxlength="30" value="함께 대전해요" autocomplete="off" required><span class="field-hint">로비의 방 목록에 표시돼요. 최대 30자.</span></label>
          <label>경기 종류<select id="room-rated" name="room-rated"><option value="casual">친선전 · 레이트 유지</option><option value="rated">랭크전 · 레이트 변경</option></select><span id="rated-help" class="field-hint">승패와 관계없이 레이트가 그대로 유지돼요.</span></label>
          <label>방 비밀번호 <span class="optional">선택 사항</span><input id="room-password" name="new-room-password" type="password" maxlength="32" autocomplete="off" placeholder="누구나 참가하려면 비워 두세요…"><span class="field-hint">비밀번호를 아는 사람만 들어올 수 있어요.</span></label>
          <div class="form-summary"><span>대전 인원</span><strong>1대1 <span class="hint">· 2명</span></strong></div>
          <p id="create-error" class="form-error" role="status"></p><button id="create" class="primary" disabled>방 만들기 <span aria-hidden="true">→</span></button>
        </form></section><aside class="room-guide"><span class="guide-art" aria-hidden="true">1 <b>vs</b> 1</span><h3>어떤 한 판을 즐길까요?</h3><p><strong>친선전</strong><br>레이트 부담 없이 편하게 즐겨요.</p><p><strong>랭크전</strong><br>상대의 레이트에 따라 증감이 결정돼요. 경기가 시작된 뒤 나가면 패배로 처리돼요.</p><p class="hint">방에 모인 두 사람이 준비한 뒤 캐릭터를 고르고 시작해요. 대전과 관전을 합쳐 최대 6명이 입장할 수 있어요.</p></aside></div>
      </section>
      <section id="panel-rankings" class="lobby-panel" aria-labelledby="rank-title" hidden>
        <div class="page-heading"><div><span class="eyebrow">한 판씩, 더 높은 곳으로</span><h2 id="rank-title">랭킹</h2><p class="hint">랭크전을 마친 플레이어의 레이트 순위예요.</p></div><span class="ranking-note">상위 100명 · 같은 레이트는 공동 순위</span></div>
        <div id="my-standing" class="my-standing">첫 랭크전을 마치고 순위에 도전해 보세요.</div>
        <section class="card ranking" aria-label="레이트 랭킹"><div id="rankings"><div class="empty"><strong>아직 랭크전 기록이 없어요</strong><p>첫 번째 대전의 주인공이 되어 보세요.</p></div></div></section>
      </section>
    </section>
    <section id="room-view" class="card" aria-labelledby="room-title" hidden>
      <div class="section-head room-header"><div class="room-heading"><div class="room-meta"><span class="eyebrow">함께 준비해요</span><h2 id="room-title">대기실</h2><p id="room-info" class="hint"></p></div><div class="room-invite" role="group" aria-label="친구 초대"><div class="room-code-badge"><span>방 코드</span><strong id="room-code" aria-label="방 코드"></strong></div><button id="copy-room-code" type="button">코드 복사</button><button id="copy-room-link" type="button">초대 링크 복사</button></div></div><button id="leave" class="quiet">방 나가기</button></div>
      <section class="room-arena" aria-labelledby="arena-title"><div class="room-zone-heading"><span class="audience-mark" aria-hidden="true">◇</span><h3 id="arena-title">대전석</h3><strong class="spectator-total"><span id="player-count">0</span>/2명</strong></div><p class="spectator-hint">준비가 끝나면 캐릭터를 선택해요</p><div id="seats" class="seats"></div></section><section class="room-spectators" aria-labelledby="spectators-title"><div class="spectator-panel-heading"><span class="audience-mark" aria-hidden="true">◉</span><h3 id="spectators-title">관전석</h3><strong class="spectator-total"><span id="spectator-count">0</span>명</strong></div><p id="spectator-hint" class="spectator-hint">경기를 함께 지켜봐요</p><ul id="spectator-list" aria-label="관전자 목록"></ul></section><div class="room-bottom"><p id="room-help">상대를 기다리는 중이에요.</p><button id="watch-instead" type="button">관전으로 전환</button><button id="take-seat" class="primary" type="button" hidden>대전 참가</button><button id="ready" class="primary" disabled>준비하기</button></div>
    </section>
    <section id="character-select-view" class="character-select-view" aria-labelledby="character-title" hidden>
      <header class="selection-header"><div><span class="eyebrow">대전 준비</span><h2 id="character-title">캐릭터를 선택해 주세요</h2><p id="selection-help">두 사람 모두 결정하면 대전을 시작합니다.</p></div><button id="cancel-character" type="button">대기실로</button></header>
      <div id="selection-players" class="selection-players"></div>
      <div class="selection-choices"><div id="character-options" class="character-options"></div></div>
      <footer class="selection-footer"><button id="online-guide" type="button">게임 방법</button><button id="confirm-character" class="primary" type="button">이 캐릭터로 결정</button></footer>
    </section>
    <section id="game-view" aria-label="온라인 경기" hidden>
      <span class="spectator-badge" id="spectator-badge" hidden>관전 중</span><span id="game-audience" class="game-audience" hidden><span aria-hidden="true">◉</span> 관전 <strong id="game-audience-count">0</strong>명</span>
      <details id="battle-menu" class="battle-menu"><summary aria-label="대전 메뉴">☰</summary><div class="battle-menu-panel"><div class="game-toolbar"><p id="game-identity"></p><div class="game-tools"><button id="field-zoom" class="quiet mobile-control" aria-pressed="false">내 필드 크게</button><details class="network-details"><summary>연결 상태</summary><p id="metrics" class="hint"></p></details></div></div><p class="battle-menu-hint">온라인 경기는 계속 진행돼요.</p><button id="battle-options" type="button">조작 옵션</button><button id="battle-return-room" type="button" hidden>대기실로 돌아가기</button><button id="battle-watch-instead" type="button">관전으로 전환</button><button id="stop-watch" type="button" hidden>관전 종료 · 로비로</button><button type="button" data-online-exit>메인 메뉴로 돌아가기</button></div></details>
      <div class="online-result"><p id="settlement" role="status"></p><button id="return-room" class="primary" hidden>대기실로 돌아가기</button></div>
      <div id="board-area" class="board-area"><div id="game-stage" class="stage"><canvas id="screen" aria-label="온라인 모드 화면" tabindex="0"></canvas></div></div>
      <div id="touch-controls" class="touch-controls" aria-label="터치 게임 조작">
        <div class="touch-move"><button data-input="1" aria-label="왼쪽 이동">←</button><button data-input="4" aria-label="빠르게 내리기">↓</button><button data-input="2" aria-label="오른쪽 이동">→</button></div>
        <div class="touch-rotate"><button data-input="16" aria-label="왼쪽 회전"><span aria-hidden="true">↶</span><small>왼 회전</small></button><button data-input="8" aria-label="오른쪽 회전"><span aria-hidden="true">↷</span><small>오른 회전</small></button></div>
      </div>
      <p class="keyboard-help hint">← → 이동 · ↓ 빠르게 내리기 · Z/X 회전</p>
    </section>
    <p id="reconnect-help" class="hint" hidden>자동으로 재접속하고 있어요. <button id="reconnect" class="text-button">다시 접속</button></p>
  </main>
  <dialog id="touch-options-dialog" aria-labelledby="touch-options-title">
    <div class="section-head"><h2 id="touch-options-title">터치 조작 옵션</h2><button id="close-touch-options" class="quiet" type="button" aria-label="터치 옵션 닫기">✕</button></div>
    <p class="hint">양손 엄지가 편한 위치로 맞춰 보세요. 온라인 경기는 계속 진행됩니다.</p>
    <label>설정할 화면<select id="touch-orientation"><option value="portrait">세로 화면</option><option value="landscape">가로 화면</option></select></label>
    <div id="touch-preview" class="touch-preview" aria-hidden="true"><div class="touch-move"><button type="button" tabindex="-1" aria-label="왼쪽 이동">←</button><button type="button" tabindex="-1" aria-label="빠르게 내리기">↓</button><button type="button" tabindex="-1" aria-label="오른쪽 이동">→</button></div><div class="touch-rotate"><button type="button" tabindex="-1" aria-label="왼쪽 회전"><span aria-hidden="true">↶</span><small>왼 회전</small></button><button type="button" tabindex="-1" aria-label="오른쪽 회전"><span aria-hidden="true">↷</span><small>오른 회전</small></button></div></div>
    <div class="touch-option-fields">
      <label for="touch-size">버튼 크기 <output id="touch-size-value" for="touch-size"></output><input type="range" id="touch-size" min="56" max="80" step="2"></label>
<label for="touch-gap">버튼 간격 <output id="touch-gap-value" for="touch-gap"></output><input type="range" id="touch-gap" min="6" max="18" step="2"></label>
<label for="touch-edge">가장자리 여백 <output id="touch-edge-value" for="touch-edge"></output><input type="range" id="touch-edge" min="0" max="24" step="2"></label>
<label for="touch-lift">아래에서 올리기 <output id="touch-lift-value" for="touch-lift"></output><input type="range" id="touch-lift" min="0" max="28" step="2"></label>
    </div>
    <label class="swap-option"><input type="checkbox" id="touch-swapped"> 이동·회전 좌우 바꾸기</label>
    <div class="section-head"><button id="touch-reset" type="button">이 화면 기본값</button><p id="touch-save-status" class="hint" role="status"></p></div>
  </dialog>
  <dialog id="share-dialog" aria-labelledby="share-title"><div class="section-head"><h2 id="share-title">친구 초대</h2><button id="close-share" class="quiet" type="button" aria-label="초대 복사 창 닫기">✕</button></div><p>자동 복사를 사용할 수 없어요. 아래 내용을 길게 누르거나 Ctrl/Cmd+C로 복사해 주세요.</p><label>복사할 내용<input id="share-value" type="text" readonly autocomplete="off" spellcheck="false"></label></dialog>
  <dialog id="code-dialog" aria-labelledby="code-title"><div class="section-head"><h2 id="code-title">코드로 참가</h2><button id="close-code" class="quiet" type="button" aria-label="방 코드 입력 닫기">✕</button></div><form id="join-form"><div class="join-fields"><label>방 코드<input id="code" name="code" maxlength="8" placeholder="예: A1B2C3D4" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label><label>비밀번호 <span class="hint">선택</span><input id="join-password" name="room-password" type="password" maxlength="32" autocomplete="off" placeholder="비밀번호가 있는 방만…"></label><button id="join" class="primary" type="submit" disabled>코드로 참가</button></div></form><p id="code-error" class="form-error" role="status"></p></dialog>
  <dialog id="password-dialog" aria-labelledby="password-title"><form id="password-form"><div class="section-head"><div><span class="eyebrow">비밀번호가 있는 방</span><h2 id="password-title">방에 참가하기</h2></div><button id="close-password" type="button" class="quiet" aria-label="비밀번호 입력 닫기">✕</button></div><p id="password-room-name" class="hint"></p><label>방 비밀번호<input id="password-value" name="password" type="password" maxlength="32" autocomplete="off" required></label><p id="join-error" class="form-error" role="status"></p><button id="password-join" class="primary" type="submit">참가하기</button></form></dialog>
  `;
