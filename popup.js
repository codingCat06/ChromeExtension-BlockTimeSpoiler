// YouTube Spoiler Blocker - Popup Script

const DEFAULT_SETTINGS = {
  enabled: true,
  thresholdMode: 'percentage', // 'percentage' or 'time'
  percentageThreshold: 30,
  timeThreshold: 10
};

// DOM 요소 - DOMContentLoaded 후에 초기화
let percentageInput, timeInput, statusMessage;
let modePercentage, modeTime, percentageSection, timeSection;

// 설정 로드
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ['enabled', 'thresholdMode', 'percentageThreshold', 'timeThreshold'],
      (result) => {
        const settings = {
          enabled: result.enabled !== undefined ? result.enabled : DEFAULT_SETTINGS.enabled,
          thresholdMode: result.thresholdMode || DEFAULT_SETTINGS.thresholdMode,
          percentageThreshold: result.percentageThreshold !== undefined ? result.percentageThreshold : DEFAULT_SETTINGS.percentageThreshold,
          timeThreshold: result.timeThreshold !== undefined ? result.timeThreshold : DEFAULT_SETTINGS.timeThreshold
        };
        resolve(settings);
      }
    );
  });
}

// 설정 저장
async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, () => {
      resolve();
    });
  });
}

// UI 업데이트
function updateUI(settings) {
  if (percentageInput) percentageInput.value = settings.percentageThreshold;
  if (timeInput) timeInput.value = settings.timeThreshold;
  
  // 모드 라디오 버튼 설정
  if (modePercentage && modeTime) {
    if (settings.thresholdMode === 'time') {
      modeTime.checked = true;
      modePercentage.checked = false;
    } else {
      modePercentage.checked = true;
      modeTime.checked = false;
    }
  }
  
  // 입력 섹션 활성화/비활성화
  updateInputSections(settings.thresholdMode);
}

// 입력 섹션 활성화/비활성화
function updateInputSections(mode) {
  if (!percentageSection || !timeSection) return;
  
  if (mode === 'percentage') {
    percentageSection.classList.remove('disabled-input');
    timeSection.classList.add('disabled-input');
  } else {
    percentageSection.classList.add('disabled-input');
    timeSection.classList.remove('disabled-input');
  }
}

// 설정 읽기 및 반영
function getSettingsFromUI() {
  return {
    enabled: true, // 항상 활성화 (popup에서 설정하면 사용하겠다는 의미)
    thresholdMode: (modeTime && modeTime.checked) ? 'time' : 'percentage',
    percentageThreshold: parseInt(percentageInput?.value) || DEFAULT_SETTINGS.percentageThreshold,
    timeThreshold: parseInt(timeInput?.value) || DEFAULT_SETTINGS.timeThreshold
  };
}

// 상태 메시지 표시
function showStatus(message, type = 'success') {
  if (!statusMessage) return;
  
  statusMessage.textContent = message;
  statusMessage.className = `status-message show ${type}`;

  setTimeout(() => {
    statusMessage.classList.remove('show');
  }, 2000);
}

// 자동 저장 (debounce 적용)
let saveTimeout = null;
async function autoSave() {
  // 이전 타이머 취소
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  // 300ms 후에 저장 (연속 입력 시 마지막 입력만 저장)
  saveTimeout = setTimeout(async () => {
    const settings = getSettingsFromUI();
    try {
      await saveSettings(settings);
      showStatus('Auto-saved!', 'success');
    } catch (error) {
      console.error('Auto-save error:', error);
      showStatus('Error saving settings', 'error');
    }
  }, 300);
}

// DOM 초기화 및 이벤트 리스너 등록
function initializeDOM() {
  // DOM 요소 가져오기
  percentageInput = document.getElementById('percentageThreshold');
  timeInput = document.getElementById('timeThreshold');
  statusMessage = document.getElementById('statusMessage');
  modePercentage = document.getElementById('modePercentage');
  modeTime = document.getElementById('modeTime');
  percentageSection = document.getElementById('percentageSection');
  timeSection = document.getElementById('timeSection');

  // 모드 라디오 버튼 변경 시 자동 저장
  if (modePercentage) {
    modePercentage.addEventListener('change', () => {
      updateInputSections('percentage');
      autoSave();
    });
  }

  if (modeTime) {
    modeTime.addEventListener('change', () => {
      updateInputSections('time');
      autoSave();
    });
  }

  // 입력값 변경 시 자동 저장 및 유효성 검사
  if (percentageInput) {
    percentageInput.addEventListener('input', () => {
      let value = parseInt(percentageInput.value);
      if (value < 0) percentageInput.value = 0;
      if (value > 100) percentageInput.value = 100;
      autoSave();
    });
  }

  if (timeInput) {
    timeInput.addEventListener('input', () => {
      let value = parseInt(timeInput.value);
      if (value < 0) timeInput.value = 0;
      if (value > 120) timeInput.value = 120;
      autoSave();
    });
  }
}

// 초기 로드
document.addEventListener('DOMContentLoaded', async () => {
  initializeDOM();
  
  // 설정 불러오기 및 UI 업데이트
  const settings = await loadSettings();
  updateUI(settings);
});
