document.addEventListener('DOMContentLoaded', () => {
    const sessions = window.sessions;
    const timerElement = document.getElementById('timer');
    const activityDetailsElement = document.getElementById('activity-details');
    const upcomingSessionsElement = document.getElementById('upcomingSessions');
    console.log(sessions);
  
    function getNextSession(sessions) {
        const now = new Date();
        return sessions.filter(session => new Date(session.startDateTime) > now).sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime))[0];
    }

    function getUpcomingSessions(sessions) {
        const now = new Date();
        const upcomingSessions = sessions.filter(session => new Date(session.startDateTime) > now).sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
        return upcomingSessions.slice(1); // Exclude the first session, which is the next session
    }
  
    function updateTimer() {
        const nextSession = getNextSession(sessions);
        if (!nextSession) {
            timerElement.textContent = 'No upcoming session in the list!';
            activityDetailsElement.textContent = '';
            return;
        }

        // const upcomingSessionslist = getUpcomingSessions(sessions);
        // if (!upcomingSessionslist || upcomingSessionslist.length === 0) {
        //     upcomingSessionsElement.textContent = ""; 
        // } else {
        //     const upcomingSessions = `upcoming sessions: `
        // }
    
        const now = new Date().getTime();
        const countDownDate = new Date(nextSession.startDateTime).getTime();
        const distance = countDownDate - now;
  
        if (distance < 0) {
            timerElement.textContent = 'Activity is ongoing or has passed';
            activityDetailsElement.textContent = '';
            return;
        }
        const pad = (num) => num.toString().padStart(2, '0');  // make sure time is in two digits with leading 0 when its <10
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = pad(Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
        const minutes = pad(Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)));
        const seconds = pad(Math.floor((distance % (1000 * 60)) / 1000));
  
        document.getElementById('days').textContent = days;
        document.getElementById('hours').textContent = hours;
        document.getElementById('minutes').textContent = minutes;
        document.getElementById('seconds').textContent = seconds;

        const activityDetails = `<span>Next Session: </span> <br> ${nextSession.activityName} <br> <span>By </span>  ${nextSession.resource}`;
        activityDetailsElement.innerHTML = activityDetails;
        
          
        // activityDetailsElement.textContent = `Next Session: ${nextSession.activityName} by <strong>${nextSession.resource}</strong>`;
    }
  
    setInterval(updateTimer, 1000);
    updateTimer();
  });