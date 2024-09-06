document.addEventListener('DOMContentLoaded', () => {
    const sessions = window.sessions;
    const timerElement = document.getElementById('timer');
    const activityDetailsElement = document.getElementById('activity-details');
    console.log(sessions);
  
    function getNextSession(sessions) {
        const now = new Date();
        return sessions.filter(session => new Date(session.startDateTime) > now).sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime))[0];
    }
  
    function updateTimer() {
        const nextSession = getNextSession(sessions);
        if (!nextSession) {
            timerElement.textContent = 'No upcoming session!';
            activityDetailsElement.textContent = '';
            return;
        }
  
        const now = new Date().getTime();
        const countDownDate = new Date(nextSession.startDateTime).getTime();
        const distance = countDownDate - now;
  
        if (distance < 0) {
            timerElement.textContent = 'Activity is ongoing or has passed';
            activityDetailsElement.textContent = '';
            return;
        }
  
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
  
        document.getElementById('days').textContent = days;
        document.getElementById('hours').textContent = hours;
        document.getElementById('minutes').textContent = minutes;
        document.getElementById('seconds').textContent = seconds;

        const activityDetails = `Next Session: ${nextSession.activityName} by <strong>${nextSession.resource}</strong> starts in`;
        activityDetailsElement.innerHTML = activityDetails;
  
        // activityDetailsElement.textContent = `Next Session: ${nextSession.activityName} by <strong>${nextSession.resource}</strong>`;
    }
  
    setInterval(updateTimer, 1000);
    updateTimer();
  });