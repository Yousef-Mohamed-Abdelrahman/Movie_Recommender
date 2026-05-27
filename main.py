import numpy as np
import pandas as pd
from flask import Flask, render_template, request, jsonify
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer
import json
import bs4 as bs
import pickle
import requests
import os

TMDB_API_KEY = 'f8c7a842dd3a11ff444ffd2d20659eb0'

filename = 'nlp_model.pkl'
model = pickle.load(open(filename, 'rb'))
vectorizer = pickle.load(open('transform.pkl','rb'))


data = None
similarity = None
tfidf = None
tfidf_matrix = None

def create_similarity():
    global data, similarity, tfidf, tfidf_matrix

    if data is None:
        data = pd.read_csv('Datasets/All_Data_movies.csv')
        data['movie_title'] = data['movie_title'].fillna('').astype(str).str.strip().str.lower()
        data = data[data['movie_title'] != ''].reset_index(drop=True)

    if similarity is None:
        data['comb'] = data['comb'].fillna('').str.lower()

        tfidf = TfidfVectorizer(stop_words='english')
        tfidf_matrix = tfidf.fit_transform(data['comb'])

        similarity = cosine_similarity(tfidf_matrix)

    return data, similarity


def rcmd(m):
    global data, similarity

    m = m.strip().lower()

    if similarity is None:
        data, similarity = create_similarity()

    if m not in data['movie_title'].values:
        return 'Sorry! try another movie name'

    idx = data.loc[data['movie_title'] == m].index[0]

    scores = list(enumerate(similarity[idx]))
    sorted_scores = sorted(scores, key=lambda x: x[1], reverse=True)

    top_movies = sorted_scores[1:11]

    return [data.iloc[i[0]]['movie_title'] for i in top_movies]


def categorized_rcmd(m, limit=10):
    global data, similarity

    m = m.strip().lower()

    if similarity is None:
        data, similarity = create_similarity()

    if m not in data['movie_title'].values:
        return 'Sorry! try another movie name'

    idx = data.loc[data['movie_title'] == m].index[0]
    movie = data.iloc[idx]
    scores = similarity[idx]

    actors = {
        str(movie.get('actor_1_name', '')).strip().lower(),
        str(movie.get('actor_2_name', '')).strip().lower(),
        str(movie.get('actor_3_name', '')).strip().lower(),
    }
    actors.discard('')
    director = str(movie.get('director_name', '')).strip().lower()
    genres = set(str(movie.get('genres', '')).strip().lower().split())

    actor_mask = data[['actor_1_name', 'actor_2_name', 'actor_3_name']].fillna('').apply(
        lambda row: bool(actors.intersection({str(item).strip().lower() for item in row})),
        axis=1
    )
    director_mask = data['director_name'].fillna('').astype(str).str.strip().str.lower() == director
    genre_mask = data['genres'].fillna('').astype(str).str.lower().apply(
        lambda value: bool(genres.intersection(set(value.split())))
    )

    def top_from_mask(mask):
        candidate_indices = [i for i in np.argsort(scores)[::-1] if i != idx and bool(mask.iloc[i])]
        return [data.iloc[i]['movie_title'] for i in candidate_indices[:limit]]

    return {
        'actor': top_from_mask(actor_mask),
        'director': top_from_mask(director_mask),
        'genre': top_from_mask(genre_mask),
    }



def convert_to_list(my_list):
    try:
        parsed = json.loads(my_list)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except json.JSONDecodeError:
        pass

    my_list = my_list.split('","')
    my_list[0] = my_list[0].replace('["','')
    my_list[-1] = my_list[-1].replace('"]','')
    return my_list



def get_suggestions():
    data = pd.read_csv('Datasets/All_Data_movies.csv')
    titles = data['movie_title'].fillna('').astype(str).str.strip()
    titles = titles[titles != '']
    return list(titles.str.capitalize())

def predict_sentiment(review):
    movie_review_list = np.array([review])
    movie_vector = vectorizer.transform(movie_review_list)
    pred = model.predict(movie_vector)
    return 'Good' if int(pred[0]) == 1 else 'Bad'


def scrape_imdb_reviews(imdb_id):
    if not imdb_id:
        return []

    url = f'https://www.imdb.com/title/{imdb_id}/reviews?ref_=tt_ov_rt'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
    except requests.RequestException:
        return []

    soup = bs.BeautifulSoup(response.text, 'lxml')
    selectors = [
        'div.text.show-more__control',
        'div[data-testid="review-content"]',
        '.ipc-html-content-inner-div',
    ]

    reviews = []
    for selector in selectors:
        for node in soup.select(selector):
            text = node.get_text(' ', strip=True)
            if text and len(text) > 40 and text not in reviews:
                reviews.append(text)
        if reviews:
            break

    return reviews[:12]


def build_review_sentiments(posted_reviews, imdb_id):
    reviews = convert_to_list(posted_reviews) if posted_reviews else []
    reviews = [review.strip() for review in reviews if review and review.strip()]

    if not reviews:
        reviews = scrape_imdb_reviews(imdb_id)

    movie_reviews = {}
    for review in reviews[:24]:
        try:
            movie_reviews[review] = predict_sentiment(review)
        except Exception:
            movie_reviews[review] = 'Unknown'

    if not movie_reviews:
        movie_reviews['No external reviews were available for this movie, so sentiment analysis could not be generated.'] = 'Unknown'

    return movie_reviews




app = Flask(__name__)

@app.route("/")
@app.route("/home")
def home():
    suggestions = get_suggestions()
    return render_template('index.html', suggestions=suggestions, tmdb_api_key=os.getenv('TMDB_API_KEY', TMDB_API_KEY))

@app.route("/similarity",methods=["POST"])
def similarity_route():
    movie = request.form['name']
    rc = categorized_rcmd(movie)
    if isinstance(rc, str):
        return jsonify({'error': rc}), 404
    else:
        return jsonify(rc)

@app.route("/recommend",methods=["POST"])
def recommend():
    # getting data from AJAX request
    title = request.form['title']
    cast_ids = request.form['cast_ids']
    cast_names = request.form['cast_names']
    cast_chars = request.form['cast_chars']
    cast_bdays = request.form['cast_bdays']
    cast_bios = request.form['cast_bios']
    cast_places = request.form['cast_places']
    cast_profiles = request.form['cast_profiles']
    imdb_id = request.form['imdb_id']
    poster = request.form['poster']
    genres = request.form['genres']
    overview = request.form['overview']
    vote_average = request.form['rating']
    vote_count = request.form['vote_count']
    release_date = request.form['release_date']
    runtime = request.form['runtime']
    status = request.form['status']
    rec_movies = request.form['rec_movies']
    rec_posters = request.form['rec_posters']
    actor_rec_movies = request.form.get('actor_rec_movies', '[]')
    actor_rec_posters = request.form.get('actor_rec_posters', '[]')
    director_rec_movies = request.form.get('director_rec_movies', '[]')
    director_rec_posters = request.form.get('director_rec_posters', '[]')
    genre_rec_movies = request.form.get('genre_rec_movies', '[]')
    genre_rec_posters = request.form.get('genre_rec_posters', '[]')
    posted_reviews = request.form.get('reviews', '')

    # get movie suggestions for auto complete
    suggestions = get_suggestions()

    # call the convert_to_list function for every string that needs to be converted to list
    rec_movies = convert_to_list(rec_movies)
    rec_posters = convert_to_list(rec_posters)
    actor_rec_movies = convert_to_list(actor_rec_movies)
    actor_rec_posters = convert_to_list(actor_rec_posters)
    director_rec_movies = convert_to_list(director_rec_movies)
    director_rec_posters = convert_to_list(director_rec_posters)
    genre_rec_movies = convert_to_list(genre_rec_movies)
    genre_rec_posters = convert_to_list(genre_rec_posters)
    cast_names = convert_to_list(cast_names)
    cast_chars = convert_to_list(cast_chars)
    cast_profiles = convert_to_list(cast_profiles)
    cast_bdays = convert_to_list(cast_bdays)
    cast_bios = convert_to_list(cast_bios)
    cast_places = convert_to_list(cast_places)
    
    # convert string to list (eg. "[1,2,3]" to [1,2,3])
    cast_ids = convert_to_list(cast_ids)
    
    # rendering the string to python string
    for i in range(len(cast_bios)):
        cast_bios[i] = cast_bios[i].replace(r'\n', '\n').replace(r'\"','\"')
    
    # combining multiple lists as a dictionary which can be passed to the html file so that it can be processed easily and the order of information will be preserved
    movie_cards = {rec_posters[i]: rec_movies[i] for i in range(len(rec_posters))}
    actor_movie_cards = {actor_rec_posters[i]: actor_rec_movies[i] for i in range(len(actor_rec_posters))}
    director_movie_cards = {director_rec_posters[i]: director_rec_movies[i] for i in range(len(director_rec_posters))}
    genre_movie_cards = {genre_rec_posters[i]: genre_rec_movies[i] for i in range(len(genre_rec_posters))}

    recommendation_sections = {
        'By Actor': actor_movie_cards,
        'By Director': director_movie_cards,
        'By Genre': genre_movie_cards,
    }

    casts = {cast_names[i]:[cast_ids[i], cast_chars[i], cast_profiles[i]] for i in range(len(cast_profiles))}

    cast_details = {cast_names[i]:[cast_ids[i], cast_profiles[i], cast_bdays[i], cast_places[i], cast_bios[i]] for i in range(len(cast_places))}

    movie_reviews = build_review_sentiments(posted_reviews, imdb_id)

    # passing all the data to the html file
    return render_template('index.html',title=title,poster=poster,overview=overview,vote_average=vote_average,
        vote_count=vote_count,release_date=release_date,runtime=runtime,status=status,genres=genres,
        movie_cards=movie_cards,recommendation_sections=recommendation_sections,reviews=movie_reviews,casts=casts,cast_details=cast_details,suggestions=suggestions,
        tmdb_api_key=os.getenv('TMDB_API_KEY', TMDB_API_KEY))

if __name__ == '__main__':
    app.run(debug=True)
