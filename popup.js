// YouTube Spoiler Blocker - Popup Script

const DEFAULT_SETTINGS = {
  enabled: false,
  thresholdMode: 'percentage', // 'percentage' or 'time'
  percentageThreshold: 30,
  timeThreshold: 10
};

// DOM 요소
const enableToggle = document.getElementById('enableToggle');
const percentageInput = document.getElementById('percentageThreshold');
const timeInput = document.getElementById('timeThreshold');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const statusMessage = document.getElementById('statusMessage');
const modePercentage = document.getElementById('modePercentage');
const modeTime = document.getElementById('modeTime');
const percentageSection = document.getElementById('percentageSection');
const timeSection = document.getElementById('timeSection');

// 설정 로드
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ['enabled', 'thresholdMode', 'percentageThreshold', 'timeThreshold'],
      (result) => {
        const settings = {
          enabled: result.enabled !== undefined ? result.enabled : DEFAULT_SETTINGS.enabled,
          thresholdMode: result.thresholdMode || DEFAULT_SETTINGS.thresholdMode,
          percentageThreshold: result.percentageThreshold || DEFAULT_SETTINGS.percentageThreshold,
          timeThreshold: result.timeThreshold || DEFAULT_SETTINGS.timeThreshold
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
  enableToggle.checked = settings.enabled;
  percentageInput.value = settings.percentageThreshold;
  timeInput.value = settings.timeThreshold;
  
  // 모드 라디오 버튼 설정
  if (settings.thresholdMode === 'time') {
    modeTime.checked = true;
    modePercentage.checked = false;
  } else {
    modePercentage.checked = true;
    modeTime.checked = false;
  }
  
  // 입력 섹션 활성화/비활성화
  updateInputSections(settings.thresholdMode);
}

// 입력 섹션 활성화/비활성화
function updateInputSections(mode) {
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
    enabled: enableToggle.checked,
    thresholdMode: modeTime.checked ? 'time' : 'percentage',
    percentageThreshold: parseInt(percentageInput.value) || DEFAULT_SETTINGS.percentageThreshold,
    timeThreshold: parseInt(timeInput.value) || DEFAULT_SETTINGS.timeThreshold
  };
}

// 상태 메시지 표시
function showStatus(message, type = 'success') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message show ${type}`;

  setTimeout(() => {
    statusMessage.classList.remove('show');
  }, 2000);
}

// 유효성 검사
function validateSettings(settings) {
  if (settings.percentageThreshold < 0 || settings.percentageThreshold > 100) {
    showStatus('Percentage must be between 0-100%', 'error');
    return false;
  }

  if (settings.timeThreshold < 0 || settings.timeThreshold > 120) {
    showStatus('Time must be between 0-120 minutes', 'error');
    return false;
  }

  return true;
}

// 저장 버튼 클릭
saveBtn.addEventListener('click', async () => {
  const settings = getSettingsFromUI();

  if (!validateSettings(settings)) {
    return;
  }

  try {
    await saveSettings(settings);
    showStatus('Settings saved!', 'success');

    // 현재 탭의 content script에 설정 변경 알림
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('youtube.com')) {
      chrome.tabs.reload(tab.id);
    }
  } catch (error) {
    console.error('Save error:', error);
    showStatus('Error saving settings', 'error');
  }
});

// 초기화 버튼 클릭
resetBtn.addEventListener('click', async () => {
  if (confirm('Reset all settings to default?')) {
    try {
      await saveSettings(DEFAULT_SETTINGS);
      updateUI(DEFAULT_SETTINGS);
      showStatus('Settings reset!', 'success');
    } catch (error) {
      console.error('Reset error:', error);
      showStatus('Error resetting settings', 'error');
    }
  }
});

// 토글 스위치 변경 시 즉시 저장
enableToggle.addEventListener('change', async () => {
  const settings = getSettingsFromUI();
  try {
    await saveSettings(settings);
    showStatus(settings.enabled ? 'Extension enabled' : 'Extension disabled', 'success');

    // 현재 탭 새로고침
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('youtube.com')) {
      chrome.tabs.reload(tab.id);
    }
  } catch (error) {
    console.error('Toggle error:', error);
    showStatus('Error saving settings', 'error');
  }
});

// 모드 라디오 버튼 변경
modePercentage.addEventListener('change', () => {
  updateInputSections('percentage');
});

modeTime.addEventListener('change', () => {
  updateInputSections('time');
});

// 입력값 실시간 유효성 검사
percentageInput.addEventListener('input', () => {
  const value = parseInt(percentageInput.value);
  if (value < 0) percentageInput.value = 0;
  if (value > 100) percentageInput.value = 100;
});

timeInput.addEventListener('input', () => {
  const value = parseInt(timeInput.value);
  if (value < 0) timeInput.value = 0;
  if (value > 120) timeInput.value = 120;
});


// 초기 로드
(async () => {
  const settings = await loadSettings();
  updateUI(settings);
})();
