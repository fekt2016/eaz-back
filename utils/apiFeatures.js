class APIFeature {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }
  filter() {
    const queryObj = { ...this.queryString };

    const excludedFields = ['sort', 'limit', 'page', 'search', 'fields'];
    excludedFields.forEach((el) => delete queryObj[el]);

    let queryStr = JSON.stringify(queryObj);

    queryStr = queryStr.replace(
      /\b(gt|gte|lt|lte|in)\b/g,
      (match) => `$${match}`,
    );

    this.query.find(JSON.parse(queryStr));

    return this;
  }
  sort() {
    if (this.queryString.sort) {
      const sorrtFields = this.queryString.sort.split(',');
      const sortOptions = sorrtFields
        .map((field) => {
          const [key, order] = field.split(':');
          return order === 'desc' ? `-${key}` : key;
        })
        .join(' ');
      this.query = this.query.sort(sortOptions);

      // const sortBy = this.queryString.sort.split(',').join(' ');
      // this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort('-createdAt');
    }

    return this;
  }
  search() {
    if (this.queryString.search) {
      const search = this.queryString.search;
      this.query = this.query.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { shopName: { $regex: search, $options: 'i' } },
        ],
      });
    }
    return this;
  }
  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select('-__v');
    }
    return this;
  }
  paginate() {
    const page = this.queryString.page * 1 || 1;
    const limit = this.queryString.limit * 1 || 100;
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);

    return this;
  }

  async getMeta() {
    const countQuery = this.query.model.find(this.query.getFilter());
    const total = await countQuery.countDocuments();
    const limit = parseInt(this.queryString.limit, 10) || 10;

    return {
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(this.queryString.page, 10) || 1,
      itemsPerPage: limit,
    };
  }
  // Uncomment the following method if you need to access the filter query
  getFilterQuery() {
    return this.query.getFilter();
  }
}

module.exports = APIFeature;
