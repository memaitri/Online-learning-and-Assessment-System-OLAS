import bcrypt from 'bcryptjs';
import prisma from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const seedDatabase = async () => {
  try {
    console.log('🗑️  Clearing existing data...');
    
    await prisma.violation.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.studentExamSession.deleteMany({});
    await prisma.exam.deleteMany({});
    await prisma.class.deleteMany({});
    await prisma.user.deleteMany({});

    console.log('✅ Cleared existing data');

    const hashedPassword = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.create({
      data: {
        name: 'Admin User',
        email: 'admin@olas.com',
        password: hashedPassword,
        role: 'admin'
      }
    });

    const facultyPassword = await bcrypt.hash('faculty123', 10);
    const faculty = await prisma.user.create({
      data: {
        name: 'Faculty User',
        email: 'faculty@olas.com',
        password: facultyPassword,
        role: 'faculty'
      }
    });

    const studentPassword = await bcrypt.hash('student123', 10);
    const student = await prisma.user.create({
      data: {
        name: 'Student User',
        email: 'student@olas.com',
        password: studentPassword,
        role: 'student'
      }
    });

    console.log('✅ Created users');

    const class1 = await prisma.class.create({
      data: {
        name: 'Data Structures and Algorithms',
        code: 'CS301',
        description: 'Advanced data structures and algorithm design',
        facultyId: faculty.id,
        createdById: faculty.id,
        students: {
          connect: [{ id: student.id }]
        }
      }
    });

    const class2 = await prisma.class.create({
      data: {
        name: 'Web Development',
        code: 'CS401',
        description: 'Full-stack web development with modern frameworks',
        facultyId: faculty.id,
        createdById: faculty.id,
        students: {
          connect: [{ id: student.id }]
        }
      }
    });

    console.log('✅ Created classes');

    const exam1 = await prisma.exam.create({
      data: {
        title: 'DSA Midterm Exam',
        description: 'Covers sorting, searching, and tree algorithms',
        classId: class1.id,
        createdById: faculty.id,
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 25 * 60 * 60 * 1000),
        duration: 120,
        allowedLanguages: ['javascript', 'python', 'java', 'c', 'cpp'],
        maxViolations: 3,
        questions: [
          {
            questionNumber: 1,
            title: 'Binary Search Implementation',
            description: 'Implement binary search algorithm',
            points: 20,
            testCases: [
              { input: '[1,2,3,4,5]\n3', expectedOutput: '2' },
              { input: '[1,2,3,4,5]\n6', expectedOutput: '-1' }
            ]
          },
          {
            questionNumber: 2,
            title: 'Reverse a Linked List',
            description: 'Write a function to reverse a singly linked list',
            points: 30,
            testCases: []
          }
        ]
      }
    });

    console.log('✅ Created exams');

    console.log('\n🎉 Database seeded successfully!\n');
    console.log('📧 Login credentials:');
    console.log('   Admin: admin@olas.com / admin123');
    console.log('   Faculty: faculty@olas.com / faculty123');
    console.log('   Student: student@olas.com / student123\n');

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

seedDatabase();
