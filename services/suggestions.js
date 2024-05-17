let suggestions = [
    "What is the patient's weight?",
    "What is the patient's height?",
    "What is the patient's date of birth?",
    "What is the main diagnosis of the report?",
    "What is the main take away from the report?",
  ];
  
  function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;
  
    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
  
      // Pick a remaining element...
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
  
      // And swap it with the current element.
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }
  
    return array;
  }
  
  function getSuggestions() {
    if (suggestions.length === 0) {
      throw new Error("All suggestions have been used");
    }
    
    shuffle(suggestions);
  
    // After shuffling, pop the last element which will remove it from the array
    let selectedSuggestion = suggestions.pop();
  
    return selectedSuggestion;
  }
  
  module.exports = {
    getSuggestions,
  };
  