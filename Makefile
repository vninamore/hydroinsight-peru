.PHONY: data test serve

data:
	python python/generate_data.py

test:
	python -m unittest discover -s python -p "test_*.py"

serve:
	python -m http.server 8000

