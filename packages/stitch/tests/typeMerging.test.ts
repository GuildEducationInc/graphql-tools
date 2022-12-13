// The below is meant to be an alternative canonical schema stitching example
// which relies on type merging.

import { graphql } from 'graphql';

import { makeExecutableSchema } from '@graphql-tools/schema';

import { addMocksToSchema } from '@graphql-tools/mock';

import { assertSome } from '@graphql-tools/utils';

import { stitchSchemas } from '../src/stitchSchemas.js';

import { v4 as uuid } from 'uuid';

describe('merging using type merging', () => {
  describe('guild schema', () => {
    let studentSchema = makeExecutableSchema({
      typeDefs: /* GraphQL */ `
        type Query {
          students(input: PageInput!): Students
          student(id: String!): Student
        }

        input PageInput {
          limit: Int!
          offset: Int!
        }

        type Student {
          id: String!
          name: String!
          major: Major!
        }

        type Major {
          id: String!
        }

        type Students {
          pageInfo: PageInfo!
          data: [Student!]!
        }

        type PageInfo {
          total: Int!
          place: Int!
        }
      `,
    });

    let enrollmentSchema = makeExecutableSchema({
      typeDefs: /* GraphQL */ `
        scalar AWSDate

        type Query {
          student(id: String!): Student
          studentsWithEnrollments(ids: [String!]!): [Student!]!
        }

        type Student {
          id: String!
          enrollments: [Enrollment!]!
        }

        type Enrollment {
          studentId: String!
          courseName: String!
          creditHours: Int!
          startDate: AWSDate!
          endDate: AWSDate!
          cost: Float!
          letterGrade: String!
        }
      `,
    });

    let majorsSchema = makeExecutableSchema({
      typeDefs: /* GraphQL */ `
        type Query {
          majors: [Major!]!
          major(id: String!): Major!
          majorsByIds(ids: [String!]!): [Major!]!
        }

        type Major {
          id: String!
          name: String!
          minimumGpa: Float!
          creditsRequired: Float!
        }
      `,
    });

    let stitchedSchema: any;

    let studentResolvers: any;
    let majorResolvers: any;
    let enrollmentsResolvers: any;

    let majorSpy: any;
    let majorsByIdsSpy: any;

    let enrollmentsByStudentIdSpy: any;
    let studentsWithEnrollmentsSpy: any;

    afterEach(() => {
      jest.resetAllMocks();
    });
    beforeEach(() => {
      majorResolvers = {
        Query: {
          major: (_source: any, args: { id: string }) => {
            return {
              id: args.id,
              name: 'What',
            };
          },
          majorsByIds: (_source: any, args: { ids: string[] }) => {
            return args.ids.map(i => ({ id: i, name: 'What' }));
          },
        },
      };
      studentResolvers = {
        Students: {
          data: (_source: any, _args: any) => {
            return Array(4)
              .fill(0)
              .map(_ => ({
                id: uuid(),
                name: 'Mock Student',
                major: {
                  id: uuid(),
                },
              }));
          },
        },
        Query: {
          student: (_source: any, args: { id: string }) => {
            return {
              id: args.id,
              name: 'Mock Student',
              major: {
                id: uuid(),
              },
            };
          },
          students: (_source: any, _args: any) => {
            return _args;
          },
        },
      };
      const resolverMethods = {
        enrollmentsByStudentId: (_source: any, args: { studentId: string }) => {
          return Array(5)
            .fill(0)
            .map(_ => ({
              studentId: args.studentId,
              courseName: 'course name',
              creditHours: 'credit hours',
              startDate: '2020-01-01',
              endDate: '2022-01-01',
              cost: 200,
              letterGrade: 'B-',
            }));
        },
        studentsWithEnrollments: (_source: any, args: { ids: string[] }) => {
          return args.ids.map(i => ({
            id: i,
            enrollments: Array(6)
              .fill(0)
              .map(_ => ({
                studentId: i,
                courseName: 'course name',
                creditHours: 'credit hours',
                startDate: '2020-01-01',
                endDate: '2022-01-01',
                cost: 200,
                letterGrade: 'B-',
              })),
          }));
        },
      };
      enrollmentsResolvers = {
        Student: {
          enrollments: (source: any, _args: any) => {
            if (!source.enrollments)
              return resolverMethods.enrollmentsByStudentId(source, { studentId: source.id } as { studentId: string });
            else return source.enrollments;
          },
        },
        Query: {
          student: (_source: any, args: { id: string }) => {
            return {
              id: args.id,
            };
          },
          studentsWithEnrollments: (source: any, args: { ids: string[] }) => {
            return resolverMethods.studentsWithEnrollments(source, args);
          },
        },
      };

      majorSpy = jest.spyOn(majorResolvers.Query, 'major');
      majorsByIdsSpy = jest.spyOn(majorResolvers.Query, 'majorsByIds');

      enrollmentsByStudentIdSpy = jest.spyOn(resolverMethods, 'enrollmentsByStudentId');
      studentsWithEnrollmentsSpy = jest.spyOn(resolverMethods, 'studentsWithEnrollments');

      studentSchema = addMocksToSchema({ schema: studentSchema, resolvers: studentResolvers });
      enrollmentSchema = addMocksToSchema({ schema: enrollmentSchema, resolvers: enrollmentsResolvers });
      majorsSchema = addMocksToSchema({ schema: majorsSchema, resolvers: majorResolvers });

      stitchedSchema = stitchSchemas({
        subschemas: [
          {
            schema: studentSchema,
            merge: {
              Student: {
                fieldName: 'student',
                selectionSet: '{ id }',
                args: originalObject => ({ id: originalObject.id }),
              },
            },
            batch: true,
          },
          {
            schema: majorsSchema,
            merge: {
              Major: {
                fieldName: 'majorsByIds',
                selectionSet: '{ id }',
                key: ({ id }) => id,
                argsFromKeys: ids => ({ ids }),
              },
            },
            batch: true,
          },
          {
            schema: enrollmentSchema,
            merge: {
              Student: {
                fieldName: 'studentsWithEnrollments',
                selectionSet: '{ id }',
                key: ({ id }) => id,
                argsFromKeys: ids => ({ ids }),
              },
            },
            batch: true,
          },
        ],
      });
    });
    test('can resolve student major', async () => {
      const query = /* GraphQL */ `
        query {
          student(id: "mock data") {
            __typename
            id
            name
            major {
              name
            }
          }
        }
      `;
      const result = await graphql({
        schema: stitchedSchema,
        source: query,
      });
      expect(result.errors).toBeUndefined();
      assertSome(result.data);
      const studentData: any = result.data['student'];
      expect(studentData.__typename).toBe('Student');
      expect(majorSpy).not.toBeCalled();
      expect(majorsByIdsSpy).toBeCalledTimes(1);
    });
    test('can resolve students majors', async () => {
      const query = /* GraphQL */ `
        query {
          students(input: { limit: 0, offset: 20 }) {
            __typename
            data {
              id
              name
              major {
                name
              }
            }
          }
        }
      `;

      const result = await graphql({
        schema: stitchedSchema,
        source: query,
      });

      expect(result.errors).toBeUndefined();
      assertSome(result.data);
      const studentData: any = result.data['students'];
      expect(studentData.__typename).toBe('Students');
      expect(majorSpy).not.toBeCalled();
      expect(majorsByIdsSpy).toBeCalledTimes(1);
    });
    test('can resolve student enrollments', async () => {
      const query = /* GraphQL */ `
        query {
          student(id: "mock data") {
            __typename
            id
            name
            enrollments {
              courseName
            }
          }
        }
      `;

      const result = await graphql({
        schema: stitchedSchema,
        source: query,
      });

      expect(result.errors).toBeUndefined();
      assertSome(result.data);
      const studentData: any = result.data['student'];
      expect(studentData.__typename).toBe('Student');
      expect(enrollmentsByStudentIdSpy).toBeCalledTimes(1);
      expect(studentsWithEnrollmentsSpy).toBeCalledTimes(0);
    });
    test('can resolve students enrollments', async () => {
      const query = /* GraphQL */ `
        query {
          students(input: { limit: 0, offset: 20 }) {
            __typename
            data {
              id
              name
              enrollments {
                studentId
                courseName
              }
            }
          }
        }
      `;

      const result = await graphql({
        schema: stitchedSchema,
        source: query,
      });
      expect(result.errors).toBeUndefined();
      assertSome(result.data);
      const studentData: any = result.data['students'];
      expect(studentData.__typename).toBe('Students');
      expect(studentsWithEnrollmentsSpy).toBeCalledTimes(1);
      expect(enrollmentsByStudentIdSpy).toBeCalledTimes(0);
    });
  });
});
