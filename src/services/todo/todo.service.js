const mongoose = require('mongoose');
const moment = require('moment');
const { TodoModel, TodoLabelModel } = require('../../models');

class TodoService {
  constructor() {
    this.TodoModel = TodoModel;
    this.TodoLabelModel = TodoLabelModel;
  }

  async addTodo({ user }, postBody) {
    const todo = this.TodoModel({ ...postBody, user: user._id });
    try {
      const response = await todo.save();
      if (postBody.notes && postBody.notes !== 'undefined') {
        await this.addTodoComment({ user }, { todoId: response._id }, { description: postBody.notes });
      }
      return { message: 'Todo has been succesfully added', ok: true };
    } catch (err) {
      throw err;
    }
  }

  async viewTodo({ user }, params) {
    try {
      return await this.TodoModel.findOne({ _id: params.id, user: user._id }).populate({ path: 'user' });
    } catch (err) {
      throw err;
    }
  }

  static createFilters(user, { filter = null, sort = null }) {
    let conditions = {
      user: mongoose.Types.ObjectId(user._id)
    };
    let searchQuery = '';
    let labelLookUp = {
      from: 'todolabels',
      localField: 'label',
      foreignField: '_id',
      as: 'label'
    };
    // sort object condition
    let sortObject = { createdAt: -1 };
    if (typeof (sort) === 'object' && !!sort) {
      sortObject = {};
      Object.keys(sort).forEach((key) => {
        if (sort[key] === 'DESC') {
          sortObject[key] = -1;
        }
        if (sort[key] === 'ASC') {
          sortObject[key] = 1;
        }
      });
    }
    if (typeof (filter) === 'object' && !!filter) {
      // filter for title name
      if ('title_contains' in filter && filter.title_contains) {
        searchQuery = filter.title_contains;
        conditions = { ...conditions, title: { $regex: searchQuery, $options: 'gi' } };
      }
      // filter for label
      if ('labelId' in filter && !!filter.labelId) {
        const labelIds = filter.labelId.map(labelId => mongoose.Types.ObjectId(labelId));
        conditions = { ...conditions, label: { $in: labelIds } };
        if (filter.label) {
          labelLookUp = {
            from: 'todolabels',
            pipeline: [
              {
                $match: {
                  name: { $regex: searchQuery, $options: 'gi' }
                }
              }
            ],
            as: 'label'
          };
        }
      }
      // filter for isCompleted flag
      if ('isCompleted' in filter) {
        conditions = { ...conditions, isCompleted: filter.isCompleted };
      }
      // check tasks for today
      if ('type' in filter && filter.type === 'today') {
        conditions = {
          ...conditions,
          isCompleted: false,
          scheduledDate: {
            $gte: new Date(moment().hours(0).minutes(0).seconds(0)),
            $lt: new Date(moment().hours(23).minutes(59).seconds(59))
          }
        };
      }
      // check backlogs tasks
      if ('type' in filter && filter.type === 'backlog') {
        // TODO:// will subject to change when intriduce Next week tasks
        conditions = {
          ...conditions,
          isCompleted: false,
          $or: [
            { scheduledDate: null },
            { scheduledDate: { $gt: new Date(moment().hours(23).minutes(59).seconds(59)) } }
          ]
        };
      }
      // check pending tasks
      if ('type' in filter && filter.type === 'pending') {
        conditions = {
          ...conditions,
          isCompleted: false,
          $and: [
            {
              scheduledDate: {
                $exists: true,
                $lte: new Date(moment().hours(0).minutes(0).seconds(0))
              }
            },
            {
              scheduledDate: { $ne: null }
            }
          ]

        };
      }
    } else {
      conditions = {
        ...conditions
      };
    }
    return { conditions, sortObject, labelLookUp };
  }

  async completedTodo({ user }, {
    first = 10, offset = 1, filter = null, sort = null
  }) {
    const { conditions: conditionsObJ, sortObject, labelLookUp } = this.constructor.createFilters(user, { filter, sort });
    let conditions = conditionsObJ;
    conditions = { ...conditions, isCompleted: true };
    try {
      const response = await this.TodoModel
        .aggregate([
          {
            $match: conditions
          },
          {
            $project: {
              name: 1,
              title: '$title',
              label: '$label',
              isCompleted: '$isCompleted',
              isInProgress: '$isInProgress',
              createdAt: '$createdAt',
              updatedAt: '$updatedAt',
              priority: '$priority',
              user: '$user',
              comments: '$comments',
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' },
              year: { $year: '$createdAt' }
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'user'
            }
          },
          {
            $lookup: labelLookUp
          },
          {
            $facet: {
              todos: [
                {
                  $project: {
                    title: '$title',
                    label: '$label',
                    isCompleted: '$isCompleted',
                    isInProgress: '$isInProgress',
                    createdAt: '$createdAt',
                    updatedAt: '$updatedAt',
                    user: '$user',
                    comments: '$comments',
                    priority: '$priority'
                  }
                },
                {
                  $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt', timezone: 'Asia/Kolkata' } },
                    list: { $push: '$$ROOT' },
                    count: { $sum: 1 }
                  }
                },
                {
                  $project: {
                    updatedAt: '$_id',
                    list: 1,
                    count: 1
                  }
                },
                {
                  $sort: sortObject
                },
                { $skip: (offset - 1) * first },
                { $limit: first }
              ],
              todosCount: [
                {
                  $group: {
                    _id: null,
                    count: { $sum: 1 }
                  }
                }
              ]
            }
          }
        ]);
      const { todos, todosCount } = response[0];
      const { count } = todosCount[0] || 0;
      return Promise.resolve({
        totalCount: count,
        data: todos
      });
    } catch (err) {
      throw err;
    }
  }

  async listTodo({ user }, {
    first = 10, offset = 1, filter = null, sort = null
  }) {
    const { conditions, sortObject, labelLookUp } = this.constructor.createFilters(user, { filter, sort });
    const response = await this.TodoModel
      .aggregate([
        {
          $match: conditions
        },
        {
          $project: {
            name: 1,
            title: '$title',
            label: '$label',
            isCompleted: '$isCompleted',
            isInProgress: '$isInProgress',
            createdAt: '$createdAt',
            updatedAt: '$updatedAt',
            scheduledDate: '$scheduledDate',
            priority: '$priority',
            user: '$user',
            comments: '$comments',
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' },
            year: { $year: '$createdAt' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $lookup: labelLookUp
        },
        {
          $unwind: {
            path: '$comments',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'comments.userId',
            foreignField: '_id',
            as: 'comments.userId'
          }
        },
        {
          $facet: {
            todos: [
              {
                $project: {
                  title: '$title',
                  label: '$label',
                  isCompleted: '$isCompleted',
                  isInProgress: '$isInProgress',
                  // createdAt: '$createdAt',
                  createdAt: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                  updatedAt: '$updatedAt',
                  scheduledDate: { $dateToString: { format: '%Y-%m-%d', date: '$scheduledDate' } },
                  user: '$user',
                  comments: '$comments',
                  priority: '$priority'
                }
              },
              {
                $group: {
                  _id: '$_id',
                  notes: { $push: '$comments' },
                  user: { $first: '$user' },
                  title: { $first: '$title' },
                  label: { $first: '$label' },
                  isCompleted: { $first: '$isCompleted' },
                  isInProgress: { $first: '$isInProgress' },
                  createdAt: { $first: '$createdAt' },
                  updatedAt: { $first: '$updatedAt' },
                  scheduledDate: { $first: '$scheduledDate' },
                  priority: { $first: '$priority' }
                }
              },
              {
                $sort: sortObject
              },
              { $skip: (offset - 1) * first },
              { $limit: first }
            ],
            todosCount: [
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 }
                }
              }
            ]
          }
        }
      ]);
    const { todos, todosCount } = response[0];
    const mapTodos = todos.map((todo) => {
      const { email } = todo.user[0];
      if (todo.notes && todo.notes.length) {
        todo.notes = todo.notes.map(comment => ({
          _id: comment._id,
          description: comment.description,
          userId: (Array.isArray(comment.userId) && comment.userId.length) ? comment.userId[0] : null
        }));
      }
      return {
        ...todo,
        user: {
          email
        }
      };
    });
    const { count } = todosCount[0] || 0;
    return Promise.resolve({
      totalCount: count,
      data: mapTodos
    });
  }

  async updateTodo({ user }, { id }, postBody) {
    postBody = {
      ...postBody,
      $currentDate: {
        updatedAt: true
      }
    };
    if (typeof postBody.isCompleted === 'boolean' && postBody.isCompleted) {
      postBody = {
        ...postBody, isInProgress: false
      };
    }
    return this.TodoModel.updateOne({
      user: user._id, isDeleted: false, status: true, _id: id
    }, { $set: postBody })
      .then(async (response) => {
        if (response && response.n !== 0) {
          if (postBody.notes && postBody.noteId && postBody.notes !== 'undefined') {
            await this.updateTodoComment({ user }, { todoId: id, id: postBody.noteId }, { description: postBody.notes });
          }
          return { message: 'Todo has been succesfully updated', ok: true };
        }
        return Promise.reject(new Error(403));
      })
      .catch(err => Promise.reject(err));
  }

  async deleteTodo({ user }, params) {
    try {
      const response = await this.TodoModel.deleteOne({
        user: user._id, isDeleted: false, status: true, _id: params.id
      });
      if (response && response.n !== 0) {
        return { ok: true, message: 'Todo deleted successfully' };
      }
      return Promise.reject(new Error(403));
    } catch (err) {
      throw err;
    }
  }

  async addTodoComment({ user }, params, postBody) {
    try {
      const { _id: userId } = user;
      const { todoId } = params;
      const { description } = postBody;
      const response = await this.TodoModel.updateOne({
        user: userId, isDeleted: false, _id: todoId
      }, { $push: { comments: { description, userId } } });
      if (response && response.n !== 0) {
        return { message: 'Todo has been succesfully commented', ok: true };
      }
      return Promise.reject(new Error(403));
    } catch (err) {
      throw err;
    }
  }

  async updateTodoComment({ user }, params, postBody) {
    try {
      const { _id: userId } = user;
      const { todoId, id: commentId } = params;
      const { description } = postBody;
      const response = await this.TodoModel.updateOne({
        user: userId, isDeleted: false, _id: todoId, 'comments._id': commentId
      }, { $set: { 'comments.$.description': description } });
      if (response && response.n !== 0) {
        return { message: 'Todo has been succesfully updated', ok: true };
      }
      return Promise.reject(new Error(403));
    } catch (err) {
      throw err;
    }
  }

  async todoLabelList({ user }) {
    const { _id: userId } = user;
    const query = { user: userId };
    try {
      return await this.TodoLabelModel.find(query);
    } catch (err) {
      throw err;
    }
  }

  async addTodoLabel(context, postBody) {
    try {
      const { user } = context;
      const { _id: userId } = user;
      await this.TodoLabelModel({ ...postBody, user: userId }).save();
      return { message: 'Todo label has been succesfully added', ok: true };
    } catch (err) {
      throw err;
    }
  }

  async updateTodoLabel({ user }, params, postBody) {
    try {
      const { id: todoLabelId } = params;
      const { _id: userId } = user;
      const { name } = postBody;
      const response = await this.TodoLabelModel.updateOne({
        user: userId, _id: todoLabelId
      }, { $set: { name } });
      if (response && response.n !== 0) {
        return { message: 'TodoLabel has been succesfully updated', ok: true };
      }
      return Promise.reject(new Error(403));
    } catch (err) {
      throw err;
    }
  }

  async deleteTodoLabel({ user }, params) {
    try {
      const { id: todoLabelId } = params;
      const response = await this.TodoLabelModel.deleteOne({
        user: user._id, _id: todoLabelId
      });
      if (response && response.n !== 0) {
        return { ok: true, message: 'TodoLabel deleted successfully' };
      }
      return Promise.reject(new Error(403));
    } catch (err) {
      throw err;
    }
  }
}

module.exports = new TodoService();
