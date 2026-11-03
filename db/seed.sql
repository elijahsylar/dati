-- ============================================================
-- D.A.T.I. — Seed Data
-- ============================================================

USE dati_trivia;

-- ============================================================
-- DEFAULT ADMINS: placeholder hashes. Set each password once with
-- POST /api/auth/setup (see README); the route refuses to overwrite a real one.
-- Hash generated with bcrypt, 10 rounds
-- ============================================================
INSERT INTO admin_users (username, password_hash, display_name, role) VALUES
('admin', '$2b$10$placeholder_hash_replace_on_first_run', 'Venue Admin', 'admin'),
('host1', '$2b$10$placeholder_hash_replace_on_first_run', 'Trivia Host', 'host');

-- ============================================================
-- THEMES
-- ============================================================
INSERT INTO themes (name, description) VALUES
('American History',    'From the Revolution to modern day — test your knowledge of U.S. history.'),
('Music Through the Decades', 'Hits, artists, and moments that defined each era of music.'),
('2000s Nostalgia',     'Pop culture, tech, TV shows, and trends from the Y2K decade.'),
('Science & Nature',    'The natural world, space, chemistry, and everything in between.'),
('Sports Legends',      'Iconic athletes, championship moments, and record-breakers.'),
('Food & Drink',        'Culinary trivia from around the world — perfect for a pub night.');

-- ============================================================
-- QUESTIONS — American History (theme_id = 1)
-- ============================================================
INSERT INTO questions (theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty) VALUES
(1, 'In what year was the Declaration of Independence signed?', '1774', '1776', '1778', '1781', 'B', 'easy'),
(1, 'Who was the first President of the United States?', 'John Adams', 'Thomas Jefferson', 'George Washington', 'Benjamin Franklin', 'C', 'easy'),
(1, 'Which amendment abolished slavery in the United States?', '12th', '13th', '14th', '15th', 'B', 'medium'),
(1, 'What was the last state to join the Union?', 'Alaska', 'Hawaii', 'Arizona', 'New Mexico', 'B', 'medium'),
(1, 'Which battle is considered the turning point of the Civil War?', 'Battle of Antietam', 'Battle of Gettysburg', 'Battle of Bull Run', 'Battle of Shiloh', 'B', 'medium'),
(1, 'Who purchased the Louisiana Territory from France?', 'George Washington', 'John Adams', 'Thomas Jefferson', 'James Madison', 'C', 'easy'),
(1, 'In what year did the United States enter World War I?', '1914', '1915', '1916', '1917', 'D', 'medium'),
(1, 'What document begins with "We the People"?', 'Declaration of Independence', 'Bill of Rights', 'U.S. Constitution', 'Articles of Confederation', 'C', 'easy'),
(1, 'Which President issued the Emancipation Proclamation?', 'Ulysses S. Grant', 'Abraham Lincoln', 'Andrew Johnson', 'James Buchanan', 'B', 'easy'),
(1, 'The Trail of Tears was the forced relocation of which group?', 'African Americans', 'Japanese Americans', 'Native Americans', 'Mexican Americans', 'C', 'medium'),
(1, 'Who was President during the Cuban Missile Crisis?', 'Dwight Eisenhower', 'John F. Kennedy', 'Lyndon Johnson', 'Richard Nixon', 'B', 'easy'),
(1, 'What year did women gain the right to vote in the U.S.?', '1918', '1919', '1920', '1921', 'C', 'medium'),
(1, 'Which President served the shortest term in office?', 'Zachary Taylor', 'James Garfield', 'William Henry Harrison', 'Warren Harding', 'C', 'hard'),
(1, 'What was the code name for the Allied invasion of Normandy?', 'Operation Torch', 'Operation Overlord', 'Operation Market Garden', 'Operation Barbarossa', 'B', 'medium'),
(1, 'The Boston Tea Party was a protest against what?', 'Stamp Act', 'Sugar Act', 'Tea Act', 'Townshend Acts', 'C', 'medium');

-- ============================================================
-- QUESTIONS — Music Through the Decades (theme_id = 2)
-- ============================================================
INSERT INTO questions (theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty) VALUES
(2, 'Which band released the album "Abbey Road"?', 'The Rolling Stones', 'The Beatles', 'The Who', 'Led Zeppelin', 'B', 'easy'),
(2, 'What instrument does a drummer play?', 'Guitar', 'Bass', 'Drums', 'Keyboard', 'C', 'easy'),
(2, 'Who is known as the "King of Pop"?', 'Prince', 'Michael Jackson', 'Elvis Presley', 'Stevie Wonder', 'B', 'easy'),
(2, 'Which artist released "Purple Rain" in 1984?', 'David Bowie', 'Michael Jackson', 'Prince', 'Bruce Springsteen', 'C', 'easy'),
(2, 'What genre did The Ramones help pioneer?', 'Disco', 'Punk rock', 'New wave', 'Grunge', 'B', 'medium'),
(2, 'Which Woodstock festival took place in 1969?', 'Woodstock 94', 'The original Woodstock', 'Woodstock 99', 'Woodstock 2009', 'B', 'easy'),
(2, 'Who sang "Respect" and is the Queen of Soul?', 'Diana Ross', 'Tina Turner', 'Aretha Franklin', 'Whitney Houston', 'C', 'easy'),
(2, 'What was Nirvana''s breakthrough album?', 'Bleach', 'Nevermind', 'In Utero', 'Unplugged in New York', 'B', 'medium'),
(2, 'Which rapper released "The Marshall Mathers LP"?', 'Jay-Z', '50 Cent', 'Eminem', 'Kanye West', 'C', 'medium'),
(2, 'What year did MTV first go on the air?', '1979', '1980', '1981', '1982', 'C', 'medium'),
(2, 'Which band performed the halftime show at Super Bowl XLII in 2008?', 'The Rolling Stones', 'U2', 'Tom Petty & the Heartbreakers', 'Bruce Springsteen', 'C', 'hard'),
(2, 'Who wrote "Bohemian Rhapsody"?', 'Elton John', 'Freddie Mercury', 'David Bowie', 'Mick Jagger', 'B', 'medium'),
(2, 'Which female artist had a hit with "Like a Virgin" in 1984?', 'Cyndi Lauper', 'Madonna', 'Whitney Houston', 'Janet Jackson', 'B', 'easy'),
(2, 'What was Elvis Presley''s first number-one hit?', 'Jailhouse Rock', 'Hound Dog', 'Heartbreak Hotel', 'Love Me Tender', 'C', 'hard'),
(2, 'Which band is known for the song "Stairway to Heaven"?', 'Pink Floyd', 'Led Zeppelin', 'Deep Purple', 'Black Sabbath', 'B', 'easy');

-- ============================================================
-- QUESTIONS — 2000s Nostalgia (theme_id = 3)
-- ============================================================
INSERT INTO questions (theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty) VALUES
(3, 'What social media platform launched in 2004?', 'Twitter', 'MySpace', 'Facebook', 'Instagram', 'C', 'easy'),
(3, 'Which phone was released by Apple in 2007?', 'iPod Touch', 'iPhone', 'iPad', 'Blackberry', 'B', 'easy'),
(3, 'What was the name of the virtual world game popular in the early 2000s?', 'Minecraft', 'Second Life', 'Club Penguin', 'Roblox', 'C', 'medium'),
(3, 'Which TV show featured the characters Jack, Kate, and Sawyer on a mysterious island?', 'Survivor', 'Lost', 'The OC', 'Heroes', 'B', 'easy'),
(3, 'What dance move became viral from the song "Crank That"?', 'The Dougie', 'Superman', 'The Stanky Leg', 'The Running Man', 'B', 'medium'),
(3, 'Which movie franchise began with "The Fellowship of the Ring" in 2001?', 'Harry Potter', 'The Matrix', 'Lord of the Rings', 'Star Wars Prequels', 'C', 'easy'),
(3, 'What portable music player dominated the 2000s?', 'Zune', 'Walkman', 'iPod', 'MiniDisc', 'C', 'easy'),
(3, 'Which reality TV show first aired in 2002 and featured Simon Cowell?', 'The Voice', 'American Idol', 'X Factor', 'America''s Got Talent', 'B', 'easy'),
(3, 'What was the name of the popular IM client with a running man logo?', 'MSN Messenger', 'Yahoo Messenger', 'AIM', 'ICQ', 'C', 'medium'),
(3, 'Which video platform launched in 2005?', 'Vimeo', 'YouTube', 'Dailymotion', 'Twitch', 'B', 'easy'),
(3, 'What flip phone was the best-selling phone of 2004?', 'Nokia 3310', 'Motorola Razr', 'Samsung SGH', 'LG Chocolate', 'B', 'medium'),
(3, 'Which animated movie featured a clownfish searching for his son?', 'Shark Tale', 'Finding Nemo', 'The Little Mermaid 2', 'SpongeBob Movie', 'B', 'easy'),
(3, 'What was Tom from MySpace famous for?', 'Creating viral videos', 'Being everyone''s first friend', 'Inventing hashtags', 'Starting Facebook', 'B', 'easy'),
(3, 'Which gaming console did Nintendo release in 2006?', 'GameCube', 'Nintendo DS', 'Wii', 'Switch', 'C', 'easy'),
(3, 'What low-rise fashion trend was everywhere in the early 2000s?', 'Bell bottoms', 'Low-rise jeans', 'Cargo pants', 'Skinny jeans', 'B', 'easy');

-- ============================================================
-- QUESTIONS — Science & Nature (theme_id = 4)
-- ============================================================
INSERT INTO questions (theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty) VALUES
(4, 'What planet is known as the Red Planet?', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'B', 'easy'),
(4, 'What is the chemical symbol for water?', 'H2O', 'CO2', 'O2', 'NaCl', 'A', 'easy'),
(4, 'How many bones are in the adult human body?', '186', '196', '206', '216', 'C', 'medium'),
(4, 'What is the largest organ in the human body?', 'Liver', 'Brain', 'Lungs', 'Skin', 'D', 'medium'),
(4, 'What gas do plants absorb from the atmosphere?', 'Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen', 'C', 'easy'),
(4, 'What is the speed of light in miles per second (approx)?', '86,000', '186,000', '286,000', '386,000', 'B', 'hard'),
(4, 'Which element has the atomic number 1?', 'Helium', 'Hydrogen', 'Oxygen', 'Carbon', 'B', 'easy'),
(4, 'What is the hardest natural substance on Earth?', 'Granite', 'Quartz', 'Diamond', 'Topaz', 'C', 'easy'),
(4, 'How long does it take light from the Sun to reach Earth?', '4 minutes', '8 minutes', '12 minutes', '16 minutes', 'B', 'medium'),
(4, 'What animal has the longest lifespan?', 'Elephant', 'Blue whale', 'Galápagos tortoise', 'Greenland shark', 'D', 'hard');

-- ============================================================
-- QUESTIONS — Sports Legends (theme_id = 5)
-- ============================================================
INSERT INTO questions (theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty) VALUES
(5, 'How many rings did Michael Jordan win with the Chicago Bulls?', '4', '5', '6', '7', 'C', 'easy'),
(5, 'Who holds the record for most home runs in a single MLB season?', 'Mark McGwire', 'Barry Bonds', 'Sammy Sosa', 'Babe Ruth', 'B', 'medium'),
(5, 'In what sport would you perform a "slam dunk"?', 'Football', 'Basketball', 'Tennis', 'Volleyball', 'B', 'easy'),
(5, 'Which country has won the most FIFA World Cup titles?', 'Germany', 'Argentina', 'Brazil', 'Italy', 'C', 'medium'),
(5, 'Who is the all-time leading scorer in NBA history?', 'Kareem Abdul-Jabbar', 'Karl Malone', 'LeBron James', 'Michael Jordan', 'C', 'medium'),
(5, 'What is the length of a marathon in miles (approx)?', '20.2', '24.2', '26.2', '28.2', 'C', 'easy'),
(5, 'Which boxer was known as "The Greatest"?', 'Mike Tyson', 'Sugar Ray Leonard', 'Muhammad Ali', 'Floyd Mayweather', 'C', 'easy'),
(5, 'What NFL team has won the most Super Bowls?', 'Dallas Cowboys', 'New England Patriots', 'Pittsburgh Steelers', 'San Francisco 49ers', 'B', 'hard'),
(5, 'Who won 23 Grand Slam singles titles in tennis?', 'Roger Federer', 'Rafael Nadal', 'Novak Djokovic', 'Serena Williams', 'D', 'medium'),
(5, 'In what year were the first modern Olympic Games held?', '1886', '1892', '1896', '1900', 'C', 'medium');

-- ============================================================
-- QUESTIONS — Food & Drink (theme_id = 6)
-- ============================================================
INSERT INTO questions (theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty) VALUES
(6, 'What country is the origin of the croissant?', 'France', 'Austria', 'Italy', 'Belgium', 'B', 'hard'),
(6, 'What is the main ingredient in guacamole?', 'Tomato', 'Avocado', 'Lime', 'Jalapeño', 'B', 'easy'),
(6, 'What type of pasta is shaped like small tubes?', 'Spaghetti', 'Fettuccine', 'Penne', 'Linguine', 'C', 'easy'),
(6, 'Which spirit is the main ingredient in a Margarita?', 'Rum', 'Vodka', 'Tequila', 'Gin', 'C', 'easy'),
(6, 'What is the most consumed beverage in the world after water?', 'Coffee', 'Tea', 'Beer', 'Milk', 'B', 'medium'),
(6, 'Sushi originated in which country?', 'China', 'Japan', 'Korea', 'Thailand', 'B', 'easy'),
(6, 'What gives bread its rise?', 'Baking soda', 'Yeast', 'Salt', 'Sugar', 'B', 'easy'),
(6, 'Which cheese is traditionally used on a Margherita pizza?', 'Cheddar', 'Parmesan', 'Mozzarella', 'Gouda', 'C', 'easy'),
(6, 'What fruit is used to make wine?', 'Apple', 'Grape', 'Cherry', 'Pear', 'B', 'easy'),
(6, 'A "pub" is short for what?', 'Public bar', 'Public house', 'Pub and grub', 'Public hub', 'B', 'medium');

-- ============================================================
-- SAMPLE EVENTS
-- ============================================================
INSERT INTO events (theme_id, title, event_date, start_time, max_teams, max_players_per_team, question_count, time_limit_seconds, status) VALUES
(1, 'Presidents Day History Night',        '2026-02-19', '19:00:00', 30, 5, 15, 30, 'published'),
(2, 'Rock & Roll Through the Ages',        '2026-02-24', '19:30:00', 30, 5, 15, 30, 'published'),
(3, 'Totally 2000s Throwback Night',       '2026-02-26', '19:00:00', 30, 5, 15, 25, 'draft'),
(6, 'Pub Grub & Brews Trivia',             '2026-03-03', '20:00:00', 25, 5, 10, 30, 'draft'),
(5, 'March Madness Sports Trivia',         '2026-03-10', '19:00:00', 30, 5, 15, 30, 'draft'),
(4, 'Science Night',    '2026-03-17', '19:00:00', 30, 5, 10, 35, 'draft');
