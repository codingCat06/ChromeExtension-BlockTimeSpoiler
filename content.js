// YouTube Time Spoiler Blocker - Content Script
// MutationObserver 기반 scaleX/translateX max 값 제어 방식

class YouTubeSpoilerBlocker {
  constructor() {
    this.enabled = false;
    this.settings = {
      thresholdMode: 'percentage', // 'percentage' or 'time'
      percentageThreshold: 30, // 마지막 30% 가림
      timeThreshold: 10 // 마지막 10분 가림
    };

    this.currentVideo = null;
    this.currentVideoSrc = null;
    this.pageObserver = null;
    this.progressObserver = null;
    this.chapterObserver = null;
    this.toggleButton = null;
    this.styleElement = null;
    this.marker = null;
    
    // 계산된 제한 정보
    this.clipData = null;
    // { clipPoint, clipPercentage, totalWidth, scrubberMaxX, chapters: [{ maxScaleX, isAfterClip }] }
    
    this.retryCount = 0;
    this.maxRetries = 10;

    this.init();
  }

  /**
   * 초기화
   */
  async init() {
    await this.loadSettings();
    this.observePageChanges();
    this.checkAndInject();
    
    // URL 변경 감지 (YouTube SPA)
    this.observeUrlChanges();
  }

  /**
   * URL 변경 감시 (YouTube SPA 대응)
   */
  observeUrlChanges() {
    let lastUrl = location.href;
    
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[Spoiler Blocker] URL changed, reinitializing...');
        this.currentVideo = null;
        this.currentVideoSrc = null;
        this.clipData = null;
        this.retryCount = 0;
        
        // 약간의 지연 후 재초기화
        setTimeout(() => this.checkAndInject(), 1000);
      }
    });
    
    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * 설정 불러오기
   */
  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        ['enabled', 'thresholdMode', 'percentageThreshold', 'timeThreshold'],
        (result) => {
          this.enabled = result.enabled !== undefined ? result.enabled : false;
          this.settings.thresholdMode = result.thresholdMode || 'percentage';
          this.settings.percentageThreshold = result.percentageThreshold || 30;
          this.settings.timeThreshold = result.timeThreshold || 10;
          resolve();
        }
      );
    });
  }

  /**
   * 활성화 상태 저장
   */
  async saveEnabled(enabled) {
    this.enabled = enabled;
    return new Promise((resolve) => {
      chrome.storage.sync.set({ enabled }, resolve);
    });
  }

  /**
   * 페이지 변경 감시 (새 비디오 감지)
   */
  observePageChanges() {
    this.pageObserver = new MutationObserver(() => {
      this.checkAndInject();
    });

    this.pageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * 비디오 플레이어 확인 및 주입
   */
  checkAndInject() {
    const video = document.querySelector('video.html5-main-video');
    if (!video) return;
    
    // 비디오 소스가 변경되었는지 확인
    const videoSrc = video.src || video.currentSrc;
    const isNewVideo = video !== this.currentVideo || videoSrc !== this.currentVideoSrc;
    
    if (isNewVideo) {
      this.currentVideo = video;
      this.currentVideoSrc = videoSrc;
      this.clipData = null;
      this.retryCount = 0;

      console.log('[Spoiler Blocker] New video detected');

      // 버튼 주입
      if (!this.toggleButton || !document.contains(this.toggleButton)) {
        this.toggleButton = null;
        this.injectToggleButton();
      }

      // 비디오 준비 확인 및 설정
      this.waitForVideoAndSetup();
    }
  }

  /**
   * 비디오 준비 대기 및 설정
   */
  waitForVideoAndSetup() {
    if (!this.currentVideo) return;
    
    const video = this.currentVideo;
    const duration = video.duration;
    
    // duration이 유효한지 확인
    if (duration && duration !== Infinity && duration > 0) {
      console.log(`[Spoiler Blocker] Video ready, duration: ${duration}s`);
      if (this.enabled) {
        // progress bar가 준비될 때까지 대기
        this.waitForProgressBarAndSetup();
      }
    } else {
      // 아직 준비되지 않음 - 재시도
      this.retryCount++;
      if (this.retryCount < this.maxRetries) {
        console.log(`[Spoiler Blocker] Waiting for video... (${this.retryCount}/${this.maxRetries})`);
        setTimeout(() => this.waitForVideoAndSetup(), 500);
      } else {
        console.log('[Spoiler Blocker] Max retries reached, waiting for events...');
        // 이벤트 기반 대기
        video.addEventListener('loadedmetadata', () => {
          if (this.enabled) {
            this.waitForProgressBarAndSetup();
          }
        }, { once: true });
        
        video.addEventListener('durationchange', () => {
          if (this.enabled && video.duration > 0) {
            this.clipData = null;
            this.waitForProgressBarAndSetup();
          }
        }, { once: true });
      }
    }
  }

  /**
   * Progress bar 준비 대기 후 설정
   */
  waitForProgressBarAndSetup(retries = 0) {
    const maxRetries = 20;
    
    const progressBar = document.querySelector('.ytp-progress-bar');
    const progressBarContainer = document.querySelector('.ytp-progress-bar-container');
    
    if (!progressBar || !progressBarContainer) {
      if (retries < maxRetries) {
        console.log(`[Spoiler Blocker] Waiting for progress bar... (${retries + 1}/${maxRetries})`);
        setTimeout(() => this.waitForProgressBarAndSetup(retries + 1), 300);
      }
      return;
    }
    
    const progressBarRect = progressBar.getBoundingClientRect();
    const totalWidth = progressBarRect.width;
    
    // progress bar width가 유효한지 확인 (최소 100px 이상)
    if (totalWidth < 100) {
      if (retries < maxRetries) {
        console.log(`[Spoiler Blocker] Progress bar width too small (${totalWidth}px), waiting... (${retries + 1}/${maxRetries})`);
        setTimeout(() => this.waitForProgressBarAndSetup(retries + 1), 300);
      }
      return;
    }
    
    // Chapter 요소들이 로드될 때까지 대기
    // YouTube는 chapter를 늦게 로드하므로, 여러 개의 chapter-hover-container가 있는지 확인
    const chapters = document.querySelectorAll('.ytp-chapter-hover-container');
    
    // chapter가 0~1개이고 아직 충분히 대기하지 않았으면 조금 더 대기
    // 하지만 5회 이상 시도했으면 그냥 진행 (chapter가 없거나 1개인 영상일 수 있음)
    if (retries < 5 && chapters.length <= 1) {
      console.log(`[Spoiler Blocker] Waiting for chapters to load... (${chapters.length} chapters found, retry ${retries + 1}/${maxRetries})`);
      setTimeout(() => this.waitForProgressBarAndSetup(retries + 1), 300);
      return;
    }
    
    console.log(`[Spoiler Blocker] Progress bar ready, width: ${totalWidth}px, chapters: ${chapters.length}`);
    this.setupSpoilerBlocker();
    
    // Chapter가 나중에 로드될 수 있으므로, 변경 감지
    this.observeChapterChanges();
  }

  /**
   * Chapter 변경 감지 (늦게 로드되는 경우 대응)
   */
  observeChapterChanges() {
    // 기존 observer가 있으면 해제
    if (this.chapterObserver) {
      this.chapterObserver.disconnect();
    }
    
    const progressBar = document.querySelector('.ytp-progress-bar');
    if (!progressBar) return;
    
    let lastChapterCount = document.querySelectorAll('.ytp-chapter-hover-container').length;
    
    this.chapterObserver = new MutationObserver(() => {
      const currentChapterCount = document.querySelectorAll('.ytp-chapter-hover-container').length;
      
      // Chapter 개수가 변경되면 재설정
      if (currentChapterCount !== lastChapterCount && currentChapterCount > 1) {
        console.log(`[Spoiler Blocker] Chapter count changed: ${lastChapterCount} -> ${currentChapterCount}, recalculating...`);
        lastChapterCount = currentChapterCount;
        
        // 약간의 지연 후 재설정 (DOM이 안정화되도록)
        setTimeout(() => {
          this.clipData = null;
          this.setupSpoilerBlocker();
        }, 500);
        
        // 한 번 감지하면 observer 해제
        this.chapterObserver.disconnect();
        this.chapterObserver = null;
      }
    });
    
    this.chapterObserver.observe(progressBar, {
      childList: true,
      subtree: true
    });
    
    // 5초 후에 자동으로 observer 해제 (불필요한 감시 방지)
    setTimeout(() => {
      if (this.chapterObserver) {
        this.chapterObserver.disconnect();
        this.chapterObserver = null;
      }
    }, 5000);
  }

  /**
   * 토글 버튼 주입
   */
  injectToggleButton() {
    const settingsButton = document.querySelector('.ytp-settings-button');
    if (!settingsButton) return;

    this.toggleButton = document.createElement('button');
    this.toggleButton.className = 'ytp-button spoiler-blocker-toggle';
    this.toggleButton.setAttribute('aria-label', 'Toggle Spoiler Blocker');
    this.toggleButton.innerHTML = this.getToggleIcon(this.enabled);
    this.toggleButton.title = this.enabled ? 'Spoiler Blocker: ON' : 'Spoiler Blocker: OFF';

    this.toggleButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.enabled = !this.enabled;
      await this.saveEnabled(this.enabled);
      this.toggleButton.innerHTML = this.getToggleIcon(this.enabled);
      this.toggleButton.title = this.enabled ? 'Spoiler Blocker: ON' : 'Spoiler Blocker: OFF';

      if (this.enabled) {
        this.setupSpoilerBlocker();
      } else {
        this.cleanup();
      }
    });

    settingsButton.parentElement.insertBefore(this.toggleButton, settingsButton);
  }

  /**
   * 아이콘 생성
   */
  getToggleIcon(enabled) {
    const color = enabled ? '#3ea6ff' : '#ffffff';
    return `
      <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%">
        <path fill="${color}" d="M18,8 C12.5,8 8,12.5 8,18 C8,23.5 12.5,28 18,28 C23.5,28 28,23.5 28,18 C28,12.5 23.5,8 18,8 Z M18,10 C22.4,10 26,13.6 26,18 C26,22.4 22.4,26 18,26 C13.6,26 10,22.4 10,18 C10,13.6 13.6,10 18,10 Z M17,13 L17,19 L22,19 L22,17 L19,17 L19,13 Z"></path>
      </svg>
    `;
  }

  /**
   * Spoiler Blocker 설정 - 제한 정보 계산 및 Observer 시작
   */
  setupSpoilerBlocker() {
    if (!this.enabled || !this.currentVideo) return;

    const duration = this.currentVideo.duration;
    if (!duration || duration === Infinity || duration <= 0) {
      console.log('[Spoiler Blocker] Invalid duration, aborting setup');
      return;
    }

    // Clip 지점 계산: 선택된 모드에 따라 계산
    let clipPoint;
    if (this.settings.thresholdMode === 'time') {
      // 시간 기준
      clipPoint = Math.max(0, duration - (this.settings.timeThreshold * 60));
    } else {
      // 비율 기준
      clipPoint = duration * (1 - this.settings.percentageThreshold / 100);
    }
    clipPoint = Math.max(0, clipPoint);
    const clipPercentage = (clipPoint / duration) * 100;

    // clipPercentage 유효성 검사 (0~100% 사이)
    if (clipPercentage < 0 || clipPercentage > 100 || isNaN(clipPercentage)) {
      console.log(`[Spoiler Blocker] Invalid clip percentage: ${clipPercentage}%, retrying...`);
      setTimeout(() => this.setupSpoilerBlocker(), 500);
      return;
    }

    // 0%면 전체 숨김 (의미 없음), 100%면 아무것도 숨기지 않음
    if (clipPercentage === 0) {
      console.log('[Spoiler Blocker] Clip at 0% - nothing to show');
    }

    console.log(`[Spoiler Blocker] Duration: ${duration}s, Clip Point: ${clipPoint}s (${clipPercentage.toFixed(1)}%)`);

    // Progress bar 정보 수집
    const progressBar = document.querySelector('.ytp-progress-bar');
    if (!progressBar) {
      console.log('[Spoiler Blocker] Progress bar not found');
      return;
    }

    const progressBarRect = progressBar.getBoundingClientRect();
    const totalWidth = progressBarRect.width;

    if (totalWidth < 100) {
      console.log(`[Spoiler Blocker] Progress bar width too small (${totalWidth}px), retrying...`);
      setTimeout(() => this.setupSpoilerBlocker(), 500);
      return;
    }

    // Chapter 정보 수집
    // YouTube는 chapter가 있으면 .ytp-chapter-hover-container를 사용
    // chapter가 없거나 1개일 때는 .ytp-progress-list를 직접 사용할 수 있음
    const chapters = document.querySelectorAll('.ytp-chapter-hover-container');
    const chaptersInfo = [];
    
    if (chapters.length <= 1) {
      // Chapter가 없거나 1개인 경우 - 전체를 하나로 취급
      // .ytp-progress-list 또는 progressBar 자체를 element로 사용
      const progressList = document.querySelector('.ytp-progress-list') || progressBar;
      
      chaptersInfo.push({
        element: progressList,
        maxScaleX: clipPercentage / 100,
        isAfterClip: false,
        isBeforeClip: false
      });
      
      console.log(`[Spoiler Blocker] Single/No chapter mode, maxScaleX: ${(clipPercentage / 100).toFixed(3)}`);
    } else {
      let accumulatedWidth = 0;
      
      chapters.forEach((chapter, index) => {
        const chapterRect = chapter.getBoundingClientRect();
        const style = window.getComputedStyle(chapter);
        
        const marginLeft = parseFloat(style.marginLeft) || 0;
        const marginRight = parseFloat(style.marginRight) || 0;
        const chapterWidth = chapterRect.width;
        const chapterTotalWidth = chapterWidth + marginLeft + marginRight;
        
        const chapterStartPercent = (accumulatedWidth / totalWidth) * 100;
        const chapterEndPercent = ((accumulatedWidth + chapterTotalWidth) / totalWidth) * 100;
        
        const chapterStartTime = (chapterStartPercent / 100) * duration;
        const chapterEndTime = (chapterEndPercent / 100) * duration;
        
        let maxScaleX = 1;
        let isAfterClip = false;
        let isBeforeClip = false;
        
        if (chapterEndTime <= clipPoint) {
          // 이전 chapter - 제한 없음
          isBeforeClip = true;
          maxScaleX = 1;
        } else if (chapterStartTime >= clipPoint) {
          // 이후 chapter - scaleX(0)
          isAfterClip = true;
          maxScaleX = 0;
        } else {
          // 현재 chapter - 부분 제한
          const chapterDuration = chapterEndTime - chapterStartTime;
          const timeIntoChapter = clipPoint - chapterStartTime;
          maxScaleX = Math.max(0, Math.min(1, timeIntoChapter / chapterDuration));
        }
        
        console.log(`[Spoiler Blocker] Chapter ${index}: ${chapterStartTime.toFixed(1)}s - ${chapterEndTime.toFixed(1)}s, maxScaleX: ${maxScaleX.toFixed(3)}, after: ${isAfterClip}, before: ${isBeforeClip}`);
        
        chaptersInfo.push({
          element: chapter,
          index,
          maxScaleX,
          isAfterClip,
          isBeforeClip
        });
        
        accumulatedWidth += chapterTotalWidth;
      });
    }

    // Scrubber max translateX 계산
    const scrubberMaxX = totalWidth * (clipPercentage / 100);

    this.clipData = {
      clipPoint,
      clipPercentage,
      totalWidth,
      scrubberMaxX,
      chapters: chaptersInfo
    };

    // 정적 CSS 적용 (영상 길이 숨기기)
    this.applyStaticStyles();

    // 마커 표시
    this.showMarker(clipPercentage);

    // MutationObserver로 progress bar 변경 감시
    this.startProgressObserver();

    // 초기 적용
    this.enforceMaxValues();

    console.log('[Spoiler Blocker] Setup completed');
  }

  /**
   * Limit 마커 표시
   */
  showMarker(clipPercentage) {
    // 기존 마커 제거
    this.removeMarker();
    
    const progressBarContainer = document.querySelector('.ytp-progress-bar-container');
    if (!progressBarContainer) return;

    this.marker = document.createElement('div');
    this.marker.className = 'spoiler-blocker-marker';
    this.marker.style.cssText = `
      position: absolute;
      left: ${clipPercentage}%;
      top: 0;
      bottom: 0;
      width: 3px;
      background: linear-gradient(to bottom, #ff6b6b, #ffc107);
      transform: translateX(-50%);
      z-index: 100;
      pointer-events: none;
      box-shadow: 0 0 8px rgba(255, 107, 107, 0.8);
      border-radius: 2px;
    `;
    
    // 마커 위에 아이콘 추가
    const icon = document.createElement('div');
    icon.style.cssText = `
      position: absolute;
      top: -18px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 14px;
      color: #ffc107;
      text-shadow: 0 0 4px rgba(0,0,0,0.8);
    `;
    icon.textContent = '🔒';
    this.marker.appendChild(icon);

    progressBarContainer.appendChild(this.marker);
    console.log(`[Spoiler Blocker] Marker placed at ${clipPercentage.toFixed(1)}%`);
  }

  /**
   * 마커 제거
   */
  removeMarker() {
    if (this.marker) {
      this.marker.remove();
      this.marker = null;
    }
    // 혹시 남아있는 것도 제거
    const existing = document.querySelector('.spoiler-blocker-marker');
    if (existing) existing.remove();
  }

  /**
   * 정적 CSS 스타일 적용
   */
  applyStaticStyles() {
    this.removeStyleElement();
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'spoiler-blocker-styles';
    this.styleElement.textContent = `
      .ytp-time-duration,
      .ytp-time-separator {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  /**
   * Progress bar 변경 감시 시작
   */
  startProgressObserver() {
    if (this.progressObserver) {
      this.progressObserver.disconnect();
    }

    const progressBar = document.querySelector('.ytp-progress-bar');
    if (!progressBar) return;

    this.progressObserver = new MutationObserver((mutations) => {
      // style 속성이 변경되면 max 값 강제
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          this.enforceMaxValues();
          break;
        }
      }
    });

    // progress bar 내의 모든 요소 감시
    this.progressObserver.observe(progressBar, {
      attributes: true,
      attributeFilter: ['style'],
      subtree: true
    });
  }

  /**
   * Max 값 강제 적용
   */
  enforceMaxValues() {
    if (!this.clipData || !this.enabled) return;

    const { chapters, scrubberMaxX } = this.clipData;

    // 각 chapter의 progress 요소들에 max scaleX 적용
    chapters.forEach((chapterInfo) => {
      const { element, maxScaleX, isAfterClip, isBeforeClip } = chapterInfo;
      
      // 이전 chapter는 제한 없음
      if (isBeforeClip) return;
      
      // progress 요소들 찾기
      const progressElements = element.querySelectorAll('.ytp-play-progress, .ytp-load-progress, .ytp-hover-progress');
      
      progressElements.forEach((el) => {
        const currentTransform = el.style.transform;
        if (!currentTransform) return;
        
        // scaleX 값 추출
        const scaleMatch = currentTransform.match(/scaleX\(([\d.]+)\)/);
        if (scaleMatch) {
          const currentScale = parseFloat(scaleMatch[1]);
          
          if (isAfterClip) {
            // 이후 chapter - 항상 0
            if (currentScale !== 0) {
              el.style.transform = 'scaleX(0)';
            }
          } else {
            // 현재 chapter - max 값 제한
            if (currentScale > maxScaleX) {
              el.style.transform = `scaleX(${maxScaleX})`;
            }
          }
        }
      });
    });

    // Scrubber (동그라미 버튼) translateX 제한
    const scrubber = document.querySelector('.ytp-scrubber-container');
    if (scrubber) {
      const currentTransform = scrubber.style.transform;
      if (currentTransform) {
        const translateMatch = currentTransform.match(/translateX\(([\d.]+)px\)/);
        if (translateMatch) {
          const currentX = parseFloat(translateMatch[1]);
          if (currentX > scrubberMaxX) {
            scrubber.style.transform = `translateX(${scrubberMaxX}px)`;
          }
        }
      }
    }
  }

  /**
   * 스타일 엘리먼트 제거
   */
  removeStyleElement() {
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
    const existing = document.getElementById('spoiler-blocker-styles');
    if (existing) existing.remove();
  }

  /**
   * 정리
   */
  cleanup() {
    // Progress observer 중지
    if (this.progressObserver) {
      this.progressObserver.disconnect();
      this.progressObserver = null;
    }

    // Chapter observer 중지
    if (this.chapterObserver) {
      this.chapterObserver.disconnect();
      this.chapterObserver = null;
    }

    // 마커 제거
    this.removeMarker();

    this.removeStyleElement();
    this.clipData = null;
    console.log('[Spoiler Blocker] Cleanup completed');
  }
}

// 초기화
let blockerInstance = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    blockerInstance = new YouTubeSpoilerBlocker();
  });
} else {
  blockerInstance = new YouTubeSpoilerBlocker();
}

// Popup에서 설정 변경 메시지 수신
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_UPDATED' && blockerInstance) {
    console.log('[Spoiler Blocker] Settings updated from popup:', message.settings);
    
    // 설정 업데이트
    blockerInstance.settings.thresholdMode = message.settings.thresholdMode;
    blockerInstance.settings.percentageThreshold = message.settings.percentageThreshold;
    blockerInstance.settings.timeThreshold = message.settings.timeThreshold;
    blockerInstance.enabled = message.settings.enabled;
    
    // 기존 설정 정리 후 재적용
    blockerInstance.cleanup();
    
    if (blockerInstance.enabled) {
      blockerInstance.clipData = null;
      blockerInstance.setupSpoilerBlocker();
    }
    
    sendResponse({ success: true });
  }
  return true;
});
