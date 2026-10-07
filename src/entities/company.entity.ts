import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";


@Entity('companies')
export class Company{
@PrimaryGeneratedColumn({type:'bigint'})
id:string;

@Column({type:'varchar',length:200,nullable:false})
name:string;

@CreateDateColumn({type:'timestamptz',nullable:false,default:()=>'NOW()'})
createdAt:Date;
}